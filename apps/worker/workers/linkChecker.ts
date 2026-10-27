import { prisma } from "@linkwarden/prisma";
import { LinkCheckStatus, Prisma } from "@linkwarden/prisma/client";
import { delay } from "@linkwarden/lib/utils";
import { checkLink, LinkCheckResult } from "../lib/checkLink";

const batchSize = Number(process.env.LINK_CHECKER_BATCH_SIZE) || 50;
const concurrency = Number(process.env.LINK_CHECKER_CONCURRENCY) || 5;
const timeoutMs =
  (Number(process.env.LINK_CHECKER_TIMEOUT_SECONDS) || 20) * 1000;
const idleIntervalInSeconds =
  Number(process.env.LINK_CHECKER_IDLE_INTERVAL_SECONDS) || 60;

const TRIAL_PERIOD_DAYS = process.env.NEXT_PUBLIC_TRIAL_PERIOD_DAYS || 14;
const REQUIRE_CC = process.env.NEXT_PUBLIC_REQUIRE_CC === "true";

function activeOwnerCondition(): Prisma.UserWhereInput {
  if (!process.env.STRIPE_SECRET_KEY) return {};

  return {
    OR: [
      { subscriptions: { is: { active: true } } },
      { parentSubscription: { is: { active: true } } },
      ...(REQUIRE_CC
        ? []
        : [
            {
              createdAt: {
                gte: new Date(
                  new Date().getTime() - Number(TRIAL_PERIOD_DAYS) * 86400000
                ),
              },
            },
          ]),
    ],
  };
}

// Builds the filter for links that are due for a check: links in collections
// whose owner has the link checker enabled, that were never checked or were
// last checked longer ago than the owner's chosen interval.
export async function getDueLinksWhere(
  now = new Date()
): Promise<Prisma.LinkWhereInput | null> {
  const intervals = await prisma.user.findMany({
    where: { linkCheckerEnabled: true },
    distinct: ["linkCheckIntervalDays"],
    select: { linkCheckIntervalDays: true },
  });

  if (intervals.length === 0) return null;

  return {
    type: "url",
    url: { not: null },
    OR: intervals.map(({ linkCheckIntervalDays }) => {
      const days = Math.max(1, linkCheckIntervalDays);

      return {
        collection: {
          owner: {
            linkCheckerEnabled: true,
            linkCheckIntervalDays,
            ...activeOwnerCondition(),
          },
        },
        OR: [
          { lastCheckedAt: null },
          { lastCheckedAt: { lt: new Date(now.getTime() - days * 86400000) } },
        ],
      };
    }),
  };
}

type DueLink = {
  id: number;
  url: string | null;
  updatedAt: Date;
  checkFailCount: number;
};

export async function saveCheckResult(link: DueLink, result: LinkCheckResult) {
  const failed =
    result.status === LinkCheckStatus.BROKEN ||
    result.status === LinkCheckStatus.UNREACHABLE;

  // Matching on url and updatedAt means a link that was edited while it was
  // being checked keeps its fresh state; it simply gets checked again later.
  // updatedAt is written back unchanged so a routine check doesn't count as a
  // user edit (it is used for sorting and for cache busting previews).
  const { count } = await prisma.link.updateMany({
    where: { id: link.id, url: link.url, updatedAt: link.updatedAt },
    data: {
      checkStatus: result.status,
      checkStatusCode: result.statusCode,
      checkError: result.error,
      checkFailCount:
        result.status === null
          ? link.checkFailCount
          : failed
            ? link.checkFailCount + 1
            : 0,
      lastCheckedAt: new Date(),
      updatedAt: link.updatedAt,
    },
  });

  return count > 0;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
) {
  let index = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (index < items.length) {
        const item = items[index++];
        await fn(item);
      }
    })()
  );

  await Promise.all(runners);
}

// Checks one batch of due links. Returns the number of links processed.
export async function checkDueLinks() {
  const where = await getDueLinksWhere();
  if (!where) return 0;

  const links = await prisma.link.findMany({
    where,
    take: batchSize,
    orderBy: [
      { lastCheckedAt: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ],
    select: { id: true, url: true, updatedAt: true, checkFailCount: true },
  });

  let broken = 0;

  await runWithConcurrency(links, concurrency, async (link) => {
    try {
      const result = await checkLink(link.url as string, { timeoutMs });
      if (
        result.status === LinkCheckStatus.BROKEN ||
        result.status === LinkCheckStatus.UNREACHABLE
      )
        broken++;
      await saveCheckResult(link, result);
    } catch (error) {
      console.error(
        "\x1b[34m%s\x1b[0m",
        `Error checking link ${link.id}:`,
        error
      );
    }
  });

  if (links.length > 0)
    console.log(
      "\x1b[34m%s\x1b[0m",
      `Checked ${links.length} link${
        links.length === 1 ? "" : "s"
      }, ${broken} broken or unreachable.`
    );

  return links.length;
}

export async function startLinkChecker() {
  if (process.env.NEXT_PUBLIC_DISABLE_LINK_CHECKER === "true") return;

  console.log("\x1b[34m%s\x1b[0m", "Starting link checker...");

  while (true) {
    let processed = 0;

    try {
      processed = await checkDueLinks();
    } catch (error) {
      console.error("\x1b[34m%s\x1b[0m", "Error in link checker:", error);
    }

    // Keep going while there's a backlog, otherwise wait for links to come due.
    await delay(processed >= batchSize ? 1 : idleIntervalInSeconds);
  }
}
