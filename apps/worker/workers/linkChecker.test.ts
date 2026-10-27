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

// Runs against a real, disposable database (it creates and deletes users and
// touches every link's lastCheckedAt), so it only runs when explicitly enabled:
// LINK_CHECKER_DB_TEST=true yarn dotenv -- vitest run apps/worker
const enabled =
  process.env.LINK_CHECKER_DB_TEST === "true" && !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("link checker worker", async () => {
  const { prisma } = await import("@linkwarden/prisma");
  const { checkDueLinks, saveCheckResult } = await import("./linkChecker");

  const DAY = 86400000;
  const runId = Date.now();
  let server: http.Server;
  let base = "";
  const userIds: number[] = [];

  async function createUser(
    name: string,
    data: { linkCheckerEnabled?: boolean; linkCheckIntervalDays?: number } = {}
  ) {
    const user = await prisma.user.create({
      data: {
        username: `lc_${name}_${runId}`,
        ...data,
        collections: { create: { name: `${name} collection` } },
      },
      include: { collections: true },
    });
    userIds.push(user.id);
    return { user, collectionId: user.collections[0].id };
  }

  function createLink(
    collectionId: number,
    path: string,
    extra: Record<string, any> = {}
  ) {
    return prisma.link.create({
      data: { name: path, url: `${base}${path}`, collectionId, ...extra },
    });
  }

  async function runUntilIdle() {
    while ((await checkDueLinks()) > 0);
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith("/ok")) res.writeHead(200).end();
      else if (req.url?.startsWith("/forbidden")) res.writeHead(403).end();
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    vi.stubEnv("ALLOW_PRIVATE_NETWORK_ACCESS", "true");
    // Keep other data in the database from interfering with these tests.
    await prisma.link.updateMany({ data: { lastCheckedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    vi.unstubAllEnvs();
  });

  it("checks never-checked links and records their status", async () => {
    const { collectionId } = await createUser("basic");
    const ok = await createLink(collectionId, "/ok");
    const broken = await createLink(collectionId, "/missing");
    const restricted = await createLink(collectionId, "/forbidden");

    await runUntilIdle();

    const [okAfter, brokenAfter, restrictedAfter] = await Promise.all(
      [ok, broken, restricted].map((l) =>
        prisma.link.findUniqueOrThrow({ where: { id: l.id } })
      )
    );

    expect(okAfter).toMatchObject({
      checkStatus: "OK",
      checkStatusCode: 200,
      checkFailCount: 0,
    });
    expect(brokenAfter).toMatchObject({
      checkStatus: "BROKEN",
      checkStatusCode: 404,
      checkFailCount: 1,
    });
    expect(restrictedAfter).toMatchObject({
      checkStatus: "RESTRICTED",
      checkStatusCode: 403,
      checkFailCount: 0,
    });
    expect(okAfter.lastCheckedAt).not.toBeNull();
    // A routine check is not an edit.
    expect(okAfter.updatedAt.getTime()).toBe(ok.updatedAt.getTime());
  });

  it("re-checks links only after the owner's interval has passed", async () => {
    const { collectionId } = await createUser("interval", {
      linkCheckIntervalDays: 7,
    });
    const recent = await createLink(collectionId, "/missing-recent", {
      lastCheckedAt: new Date(Date.now() - 6 * DAY),
      checkStatus: "OK",
    });
    const due = await createLink(collectionId, "/missing-due", {
      lastCheckedAt: new Date(Date.now() - 8 * DAY),
      checkStatus: "OK",
    });

    await runUntilIdle();

    expect(
      (await prisma.link.findUniqueOrThrow({ where: { id: recent.id } }))
        .checkStatus
    ).toBe("OK");
    expect(
      (await prisma.link.findUniqueOrThrow({ where: { id: due.id } }))
        .checkStatus
    ).toBe("BROKEN");
  });

  it("respects different intervals for different users", async () => {
    const daily = await createUser("daily", { linkCheckIntervalDays: 1 });
    const monthly = await createUser("monthly", { linkCheckIntervalDays: 30 });
    const twoDaysAgo = new Date(Date.now() - 2 * DAY);

    const dailyLink = await createLink(daily.collectionId, "/missing-d", {
      lastCheckedAt: twoDaysAgo,
    });
    const monthlyLink = await createLink(monthly.collectionId, "/missing-m", {
      lastCheckedAt: twoDaysAgo,
    });

    await runUntilIdle();

    const d = await prisma.link.findUniqueOrThrow({
      where: { id: dailyLink.id },
    });
    const m = await prisma.link.findUniqueOrThrow({
      where: { id: monthlyLink.id },
    });
    expect(d.checkStatus).toBe("BROKEN");
    expect(d.lastCheckedAt!.getTime()).toBeGreaterThan(twoDaysAgo.getTime());
    expect(m.checkStatus).toBeNull();
    expect(m.lastCheckedAt!.getTime()).toBe(twoDaysAgo.getTime());
  });

  it("skips users who turned the checker off", async () => {
    const { collectionId } = await createUser("off", {
      linkCheckerEnabled: false,
    });
    const link = await createLink(collectionId, "/missing-off");

    await runUntilIdle();

    expect(
      await prisma.link.findUniqueOrThrow({ where: { id: link.id } })
    ).toMatchObject({ checkStatus: null, lastCheckedAt: null });
  });

  it("ignores links without a URL (uploaded files)", async () => {
    const { collectionId } = await createUser("files");
    const file = await prisma.link.create({
      data: { name: "file", type: "pdf", collectionId },
    });

    await runUntilIdle();

    expect(
      (await prisma.link.findUniqueOrThrow({ where: { id: file.id } }))
        .lastCheckedAt
    ).toBeNull();
  });

  it("counts consecutive failures and resets them on success", async () => {
    const { collectionId } = await createUser("failcount", {
      linkCheckIntervalDays: 1,
    });
    const link = await createLink(collectionId, "/missing-fc");

    await runUntilIdle();
    await prisma.link.update({
      where: { id: link.id },
      data: { lastCheckedAt: new Date(Date.now() - 2 * DAY) },
    });
    await runUntilIdle();

    let after = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
    expect(after.checkFailCount).toBe(2);

    // The page comes back.
    await prisma.link.update({
      where: { id: link.id },
      data: { url: `${base}/ok-fc`, lastCheckedAt: null },
    });
    await runUntilIdle();

    after = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
    expect(after).toMatchObject({ checkStatus: "OK", checkFailCount: 0 });
  });

  it("drops a result when the link was edited during the check", async () => {
    const { collectionId } = await createUser("race");
    const link = await createLink(collectionId, "/missing-race");

    // The user changes the URL while the old one is being checked.
    await prisma.link.update({
      where: { id: link.id },
      data: { url: `${base}/ok-race` },
    });

    const saved = await saveCheckResult(link, {
      status: "BROKEN",
      statusCode: 404,
      error: null,
    });

    expect(saved).toBe(false);
    expect(
      await prisma.link.findUniqueOrThrow({ where: { id: link.id } })
    ).toMatchObject({ checkStatus: null, lastCheckedAt: null });
  });

  it("keeps the failure count when a link is skipped", async () => {
    const { collectionId } = await createUser("skip");
    const link = await createLink(collectionId, "/whatever", {
      checkFailCount: 3,
    });

    await saveCheckResult(link, {
      status: null,
      statusCode: null,
      error: "URL resolves to a blocked internal IP address.",
    });

    expect(
      await prisma.link.findUniqueOrThrow({ where: { id: link.id } })
    ).toMatchObject({ checkStatus: null, checkFailCount: 3 });
  });
});
