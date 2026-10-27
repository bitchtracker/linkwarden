import type { NextApiRequest, NextApiResponse } from "next";
import verifyUser from "@/lib/api/verifyUser";
import getLinkCheckerReport from "@/lib/api/controllers/linkChecker/getLinkCheckerReport";
import recheckLinks from "@/lib/api/controllers/linkChecker/recheckLinks";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await verifyUser({ req, res });
  if (!user) return;

  if (req.method === "GET") {
    const { response, status } = await getLinkCheckerReport(user.id);
    return res.status(status).json({ response });
  }

  if (req.method === "POST") {
    if (process.env.NEXT_PUBLIC_DEMO === "true") {
      return res.status(400).json({
        response:
          "This action is disabled because this is a read-only demo of Linkwarden.",
      });
    }

    if (process.env.NEXT_PUBLIC_DISABLE_LINK_CHECKER === "true") {
      return res.status(400).json({
        response: "The link checker is disabled on this instance.",
      });
    }

    const { response, status } = await recheckLinks(user.id);
    return res.status(status).json({ response });
  }

  return res.status(405).json({ response: "Method not allowed." });
}
