import { prisma } from "@linkwarden/prisma";

// Marks every link the user owns as due, so the worker checks them again on its
// next pass. Raw SQL keeps updatedAt untouched (Prisma's updateMany would bump
// it on every link, which is reserved for real edits).
export default async function recheckLinks(userId: number) {
  const count = await prisma.$executeRaw`
    UPDATE "Link" SET "lastCheckedAt" = NULL
    WHERE "type" = 'url'
      AND "url" IS NOT NULL
      AND "lastCheckedAt" IS NOT NULL
      AND "collectionId" IN (SELECT "id" FROM "Collection" WHERE "ownerId" = ${userId})
  `;

  return { response: { count }, status: 200 };
}
