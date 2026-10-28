import { safeFetch } from "@linkwarden/lib/safeFetch";
import { UnsafeUrlError } from "@linkwarden/lib/ssrf";
import { LinkCheckStatus } from "@linkwarden/prisma/client";

export type LinkCheckResult = {
  // null means the link was not checked (e.g. it points to a private network
  // address the server isn't allowed to reach), so no status is recorded.
  status: LinkCheckStatus | null;
  statusCode: number | null;
  error: string | null;
};

// Status codes that usually mean the site is refusing automated requests
// (login walls, bot protection, rate limits) rather than the page being gone.
// 503 ("temporarily unavailable") is included because many sites send it to
// automated clients while serving browsers normally, and even when it is
// genuine it says nothing about the link being permanently dead.
const RESTRICTED_STATUS_CODES = new Set([401, 403, 407, 429, 451, 503, 999]);

export const RESTRICTED_MESSAGE =
  "The site refused the automated check. The page may still work in a browser.";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type HeaderLookup = {
  get(name: string): string | null;
  keys(): Iterable<string>;
};

// Bot protection often answers automated requests with a challenge page and
// an error status (commonly 403 or 503) while real browsers get the page, so
// an error response that carries a challenge marker is the site's restriction,
// not a dead link.
export function isBotChallenge(headers?: HeaderLookup | null): boolean {
  if (!headers) return false;

  if (headers.get("cf-mitigated")?.toLowerCase() === "challenge") return true;
  if (headers.get("www-authenticate")) return true;
  if (/challenge|captcha/i.test(headers.get("x-amzn-waf-action") || ""))
    return true;
  if (/ddos-guard/i.test(headers.get("server") || "")) return true;

  for (const name of headers.keys()) {
    if (/challenge|captcha/i.test(name)) return true;
  }

  return false;
}

export function classifyStatusCode(
  statusCode: number,
  headers?: HeaderLookup | null
): LinkCheckStatus {
  if (statusCode >= 200 && statusCode < 400) return LinkCheckStatus.OK;
  if (RESTRICTED_STATUS_CODES.has(statusCode) || isBotChallenge(headers))
    return LinkCheckStatus.RESTRICTED;
  return LinkCheckStatus.BROKEN;
}

export function describeError(error: any): string {
  const code = error?.code || error?.cause?.code || error?.errno;

  if (error?.name === "AbortError" || error?.type === "request-timeout")
    return "The request timed out.";

  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "The domain could not be resolved.";
    case "ECONNREFUSED":
      return "The connection was refused.";
    case "ECONNRESET":
      return "The connection was reset.";
    case "ETIMEDOUT":
      return "The connection timed out.";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "The host is unreachable.";
    case "CERT_HAS_EXPIRED":
      return "The site's TLS certificate has expired.";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "The site's TLS certificate is not valid.";
  }

  const message = String(error?.message || error || "Unknown error");
  return message.length > 300 ? message.slice(0, 300) + "…" : message;
}

async function request(url: string, method: "HEAD" | "GET", timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await safeFetch(url, {
      method,
      signal: controller.signal as any,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    // Only the status matters, so don't download the body.
    try {
      (response.body as any)?.destroy?.();
    } catch {}

    return { status: response.status, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkLink(
  url: string,
  { timeoutMs = 20_000 }: { timeoutMs?: number } = {}
): Promise<LinkCheckResult> {
  try {
    // HEAD is cheap, but plenty of servers answer it incorrectly (405, 404,
    // 403...), so any non-success answer is confirmed with a GET.
    let response: Awaited<ReturnType<typeof request>> | null = null;

    try {
      response = await request(url, "HEAD", timeoutMs);
    } catch (error) {
      if (error instanceof UnsafeUrlError) throw error;
    }

    if (response === null || response.status >= 400) {
      response = await request(url, "GET", timeoutMs);
    }

    const status = classifyStatusCode(response.status, response.headers);

    return {
      status,
      statusCode: response.status,
      error: status === LinkCheckStatus.RESTRICTED ? RESTRICTED_MESSAGE : null,
    };
  } catch (error: any) {
    if (error instanceof UnsafeUrlError) {
      // A domain that no longer resolves is a dead link, anything else the
      // SSRF guard rejects is a link we're not allowed to check.
      if (/could not be resolved/i.test(error.message)) {
        return {
          status: LinkCheckStatus.UNREACHABLE,
          statusCode: null,
          error: "The domain could not be resolved.",
        };
      }

      return { status: null, statusCode: null, error: error.message };
    }

    if (/redirected too many times/i.test(error?.message || "")) {
      return {
        status: LinkCheckStatus.BROKEN,
        statusCode: null,
        error: "The link redirected too many times.",
      };
    }

    return {
      status: LinkCheckStatus.UNREACHABLE,
      statusCode: null,
      error: describeError(error),
    };
  }
}
