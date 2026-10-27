import { prisma } from "@linkwarden/prisma";
import { LinkCheckStatus, Prisma } from "@linkwarden/prisma/client";

const PROBLEM_LINK_LIMIT = 500;

// Only links in collections the user owns are checked on their schedule, so
// the report covers the same set.
export const checkableLinksWhere = (userId: number): Prisma.LinkWhereInput => ({
  type: "url",
  url: { not: null },
  collection: { ownerId: userId },
});

export default async function getLinkCheckerReport(userId: number) {
  const where = checkableLinksWhere(userId);

  const [total, grouped, lastChecked, problemLinks] = await Promise.all([
    prisma.link.count({ where }),
    prisma.link.groupBy({
      by: ["checkStatus"],
      where: { ...where, lastCheckedAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.link.aggregate({
      where,
      _max: { lastCheckedAt: true },
    }),
    prisma.link.findMany({
      where: {
        ...where,
        checkStatus: {
          in: [
            LinkCheckStatus.BROKEN,
            LinkCheckStatus.UNREACHABLE,
            LinkCheckStatus.RESTRICTED,
          ],
        },
      },
      orderBy: [{ checkStatus: "asc" }, { lastCheckedAt: "desc" }],
      take: PROBLEM_LINK_LIMIT,
      select: {
        id: true,
        name: true,
        url: true,
        checkStatus: true,
        checkStatusCode: true,
        checkError: true,
        checkFailCount: true,
        lastCheckedAt: true,
        collection: { select: { id: true, name: true } },
      },
    }),
  ]);

  const counts = {
    OK: 0,
    BROKEN: 0,
    RESTRICTED: 0,
    UNREACHABLE: 0,
    SKIPPED: 0,
  };
  let checked = 0;

  for (const row of grouped) {
    checked += row._count._all;
    counts[row.checkStatus ?? "SKIPPED"] += row._count._all;
  }

  return {
    response: {
      total,
      checked,
      pending: total - checked,
      counts,
      lastCheckedAt: lastChecked._max.lastCheckedAt,
      problemLinks,
    },
    status: 200,
  };
}
