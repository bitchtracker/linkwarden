import http from "http";
import { AddressInfo } from "net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { checkLink, classifyStatusCode } from "./checkLink";

let server: http.Server;
let base = "";
const requests: { method?: string; url?: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    const head = req.method === "HEAD";

    switch (req.url) {
      case "/ok":
        res.writeHead(200).end(head ? undefined : "ok");
        return;
      case "/not-found":
        res.writeHead(404).end();
        return;
      case "/gone":
        res.writeHead(410).end();
        return;
      case "/server-error":
        res.writeHead(500).end();
        return;
      case "/forbidden":
        res.writeHead(403).end();
        return;
      case "/rate-limited":
        res.writeHead(429).end();
        return;
      case "/no-head":
        res.writeHead(head ? 405 : 200).end();
        return;
      case "/head-lies":
        res.writeHead(head ? 404 : 200).end();
        return;
      case "/head-hangs":
        if (!head) res.writeHead(200).end();
        return;
      case "/redirect":
        res.writeHead(301, { Location: "/ok" }).end();
        return;
      case "/redirect-to-404":
        res.writeHead(302, { Location: "/not-found" }).end();
        return;
      case "/redirect-loop":
        res.writeHead(302, { Location: "/redirect-loop" }).end();
        return;
      case "/challenge-503":
        // Modelled on a real proof-of-work bot challenge (GroundShade).
        res
          .writeHead(503, {
            "Retry-After": "120",
            "WWW-Authenticate": 'GroundShade realm="example", scheme="x"',
            "X-GroundShade-Challenge": "1",
          })
          .end();
        return;
      case "/cloudflare-challenge":
        res.writeHead(503, { "cf-mitigated": "challenge" }).end();
        return;
      case "/unavailable":
        res.writeHead(503, { "Retry-After": "120" }).end();
        return;
      case "/hang":
        return;
      case "/endless-body":
        // Headers arrive, the body never finishes. Only the status matters.
        if (head) {
          res.writeHead(405).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.write("<html>");
        return;
      default:
        res.writeHead(404).end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  vi.unstubAllEnvs();
});

beforeEach(() => {
  requests.length = 0;
  vi.stubEnv("ALLOW_PRIVATE_NETWORK_ACCESS", "true");
});

describe("classifyStatusCode", () => {
  it.each([
    [200, "OK"],
    [204, "OK"],
    [304, "OK"],
    [400, "BROKEN"],
    [404, "BROKEN"],
    [410, "BROKEN"],
    [500, "BROKEN"],
    [503, "BROKEN"],
    [401, "RESTRICTED"],
    [403, "RESTRICTED"],
    [429, "RESTRICTED"],
    [999, "RESTRICTED"],
  ])("%i -> %s", (code, status) => {
    expect(classifyStatusCode(code)).toBe(status);
  });
});

describe("checkLink", () => {
  it("marks a working link as OK using only a HEAD request", async () => {
    await expect(checkLink(`${base}/ok`)).resolves.toEqual({
      status: "OK",
      statusCode: 200,
      error: null,
    });
    expect(requests.map((r) => r.method)).toEqual(["HEAD"]);
  });

  it("marks 404 and 410 as BROKEN after confirming with GET", async () => {
    await expect(checkLink(`${base}/not-found`)).resolves.toMatchObject({
      status: "BROKEN",
      statusCode: 404,
    });
    expect(requests.map((r) => r.method)).toEqual(["HEAD", "GET"]);

    await expect(checkLink(`${base}/gone`)).resolves.toMatchObject({
      status: "BROKEN",
      statusCode: 410,
    });
  });

  it("marks server errors as BROKEN", async () => {
    await expect(checkLink(`${base}/server-error`)).resolves.toMatchObject({
      status: "BROKEN",
      statusCode: 500,
    });
  });

  it("marks bot challenges as RESTRICTED even with a 5xx status", async () => {
    await expect(checkLink(`${base}/challenge-503`)).resolves.toMatchObject({
      status: "RESTRICTED",
      statusCode: 503,
    });
    await expect(
      checkLink(`${base}/cloudflare-challenge`)
    ).resolves.toMatchObject({ status: "RESTRICTED", statusCode: 503 });
  });

  it("still marks a plain 503 as BROKEN", async () => {
    await expect(checkLink(`${base}/unavailable`)).resolves.toMatchObject({
      status: "BROKEN",
      statusCode: 503,
    });
  });

  it("marks bot-blocking answers as RESTRICTED, not broken", async () => {
    await expect(checkLink(`${base}/forbidden`)).resolves.toMatchObject({
      status: "RESTRICTED",
      statusCode: 403,
    });
    await expect(checkLink(`${base}/rate-limited`)).resolves.toMatchObject({
      status: "RESTRICTED",
      statusCode: 429,
    });
  });

  it("falls back to GET when the server rejects or mishandles HEAD", async () => {
    await expect(checkLink(`${base}/no-head`)).resolves.toMatchObject({
      status: "OK",
      statusCode: 200,
    });
    await expect(checkLink(`${base}/head-lies`)).resolves.toMatchObject({
      status: "OK",
      statusCode: 200,
    });
  });

  it("falls back to GET when HEAD times out", async () => {
    await expect(
      checkLink(`${base}/head-hangs`, { timeoutMs: 300 })
    ).resolves.toMatchObject({ status: "OK", statusCode: 200 });
  });

  it("follows redirects to the final status", async () => {
    await expect(checkLink(`${base}/redirect`)).resolves.toMatchObject({
      status: "OK",
      statusCode: 200,
    });
    await expect(checkLink(`${base}/redirect-to-404`)).resolves.toMatchObject({
      status: "BROKEN",
      statusCode: 404,
    });
  });

  it("marks redirect loops as BROKEN", async () => {
    await expect(checkLink(`${base}/redirect-loop`)).resolves.toEqual({
      status: "BROKEN",
      statusCode: null,
      error: "The link redirected too many times.",
    });
  });

  it("marks a server that never answers as UNREACHABLE", async () => {
    const started = Date.now();
    await expect(
      checkLink(`${base}/hang`, { timeoutMs: 300 })
    ).resolves.toEqual({
      status: "UNREACHABLE",
      statusCode: null,
      error: "The request timed out.",
    });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("does not wait for the response body", async () => {
    const started = Date.now();
    await expect(
      checkLink(`${base}/endless-body`, { timeoutMs: 5000 })
    ).resolves.toMatchObject({ status: "OK", statusCode: 200 });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("marks a refused connection as UNREACHABLE", async () => {
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));

    await expect(checkLink(`http://127.0.0.1:${port}/`)).resolves.toEqual({
      status: "UNREACHABLE",
      statusCode: null,
      error: "The connection was refused.",
    });
  });

  it("marks a domain that no longer resolves as UNREACHABLE", async () => {
    vi.stubEnv("ALLOW_PRIVATE_NETWORK_ACCESS", "false");

    await expect(
      checkLink("https://linkwarden-link-checker-test.invalid/")
    ).resolves.toEqual({
      status: "UNREACHABLE",
      statusCode: null,
      error: "The domain could not be resolved.",
    });
  });

  it("skips private network addresses when they are not allowed", async () => {
    vi.stubEnv("ALLOW_PRIVATE_NETWORK_ACCESS", "false");

    const result = await checkLink(`${base}/ok`);
    expect(result.status).toBeNull();
    expect(result.error).toMatch(/blocked/i);
    expect(requests).toHaveLength(0);
  });

  it("skips non-http links", async () => {
    const result = await checkLink("ftp://example.com/file");
    expect(result.status).toBeNull();
  });
});
