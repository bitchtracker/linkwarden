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
const RESTRICTED_STATUS_CODES = new Set([401, 403, 407, 429, 451, 999]);

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export function classifyStatusCode(statusCode: number): LinkCheckStatus {
  if (statusCode >= 200 && statusCode < 400) return LinkCheckStatus.OK;
  if (RESTRICTED_STATUS_CODES.has(statusCode))
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

    return response.status;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkLink(
  url: string,
  { timeoutMs = 20_000 }: { timeoutMs?: number } = {}
): Promise<LinkCheckResult> {
  let statusCode: number | null = null;

  try {
    // HEAD is cheap, but plenty of servers answer it incorrectly (405, 404,
    // 403...), so any non-success answer is confirmed with a GET.
    try {
      statusCode = await request(url, "HEAD", timeoutMs);
    } catch (error) {
      if (error instanceof UnsafeUrlError) throw error;
      statusCode = null;
    }

    if (statusCode === null || statusCode >= 400) {
      statusCode = await request(url, "GET", timeoutMs);
    }

    return {
      status: classifyStatusCode(statusCode),
      statusCode,
      error: null,
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
