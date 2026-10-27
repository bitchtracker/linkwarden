import { LinkIncludingShortenedCollectionAndTags } from "@linkwarden/types/global";
import { useTranslation } from "next-i18next";
import clsx from "clsx";

export const linkCheckStatusStyles = {
  OK: {
    icon: "bi-check-circle-fill",
    color: "text-success",
    label: "link_status_ok",
  },
  BROKEN: {
    icon: "bi-x-circle-fill",
    color: "text-error",
    label: "link_status_broken",
  },
  UNREACHABLE: {
    icon: "bi-exclamation-triangle-fill",
    color: "text-error",
    label: "link_status_unreachable",
  },
  RESTRICTED: {
    icon: "bi-shield-lock-fill",
    color: "text-warning",
    label: "link_status_restricted",
  },
} as const;

export default function LinkCheckStatusRow({
  link,
}: {
  link: LinkIncludingShortenedCollectionAndTags;
}) {
  const { t } = useTranslation();

  if (!link.checkStatus || !link.lastCheckedAt) return null;

  const style = linkCheckStatusStyles[link.checkStatus];
  const detail =
    link.checkStatus === "OK"
      ? null
      : link.checkStatusCode
        ? `HTTP ${link.checkStatusCode}`
        : link.checkError;

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs mt-2"
      data-testid="link-check-status"
    >
      <span className={clsx("flex items-center gap-1", style.color)}>
        <i className={clsx(style.icon, "leading-none")}></i>
        {t(style.label)}
      </span>
      {detail && <span className="text-neutral">{detail}</span>}
      <span className="text-neutral">
        ·{" "}
        {t("checked_on", {
          date: new Date(link.lastCheckedAt).toLocaleDateString(),
        })}
      </span>
    </div>
  );
}
