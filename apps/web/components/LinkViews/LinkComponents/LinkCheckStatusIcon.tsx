import { LinkIncludingShortenedCollectionAndTags } from "@linkwarden/types/global";
import { useTranslation } from "next-i18next";
import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Shown next to a link when the link checker found that it no longer works.
function LinkCheckStatusIcon({
  link,
}: {
  link: LinkIncludingShortenedCollectionAndTags;
}) {
  const { t } = useTranslation();

  if (link.checkStatus !== "BROKEN" && link.checkStatus !== "UNREACHABLE")
    return null;

  const label =
    link.checkStatus === "BROKEN"
      ? t("link_status_broken")
      : t("link_status_unreachable");

  const detail =
    link.checkStatus === "BROKEN" && link.checkStatusCode
      ? `HTTP ${link.checkStatusCode}`
      : link.checkError;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="text-error flex items-center shrink-0"
            aria-label={label}
            data-testid="link-check-status-icon"
            onClick={(e) => e.stopPropagation()}
          >
            <i className="bi-exclamation-triangle-fill text-xs leading-none"></i>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {label}
            {detail ? ` · ${detail}` : ""}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default React.memo(LinkCheckStatusIcon);
