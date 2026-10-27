import { LinkCheckStatus } from "@linkwarden/prisma/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

export type LinkCheckerProblemLink = {
  id: number;
  name: string;
  url: string | null;
  checkStatus: LinkCheckStatus;
  checkStatusCode: number | null;
  checkError: string | null;
  checkFailCount: number;
  lastCheckedAt: string | null;
  collection: { id: number; name: string };
};

export type LinkCheckerReport = {
  total: number;
  checked: number;
  pending: number;
  counts: Record<LinkCheckStatus | "SKIPPED", number>;
  lastCheckedAt: string | null;
  problemLinks: LinkCheckerProblemLink[];
};

const useLinkCheckerReport = () => {
  const { status } = useSession();

  return useQuery({
    queryKey: ["link-checker"],
    queryFn: async () => {
      const response = await fetch("/api/v1/link-checker");
      const data = await response.json();
      if (!response.ok) throw new Error(data.response);

      return data.response as LinkCheckerReport;
    },
    enabled: status === "authenticated",
    refetchInterval: 30_000,
  });
};

const useRecheckLinks = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/v1/link-checker", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.response);

      return data.response as { count: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["link-checker"] });
    },
  });
};

export { useLinkCheckerReport, useRecheckLinks };
