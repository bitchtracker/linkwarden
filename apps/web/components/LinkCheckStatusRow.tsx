import { LinkIncludingShortenedCollectionAndTags } from "@linkwarden/types/global";
import { useTranslation } from "next-i18next";
import clsx from "clsx";
import { TFunction } from "i18next";

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

const STATUS_CODE_REASONS: Record<number, string> = {
  404: "http_reason_not_found",
  410: "http_reason_gone",
  500: "http_reason_server_error",
  502: "http_reason_bad_gateway",
  504: "http_reason_gateway_timeout",
};

// A short, plain-language explanation of a check result.
export function linkCheckDetail(
  t: TFunction,
  link: {
    checkStatus?: keyof typeof linkCheckStatusStyles | null;
    checkStatusCode?: number | null;
    checkError?: string | null;
  }
): string | null {
  const code = link.checkStatusCode ? ` (HTTP ${link.checkStatusCode})` : "";

  switch (link.checkStatus) {
    case "RESTRICTED":
      return t("link_status_restricted_desc") + code;
    case "BROKEN":
    case "UNREACHABLE":
      if (link.checkStatusCode) {
        const reason = STATUS_CODE_REASONS[link.checkStatusCode];
        return reason ? t(reason) + code : `HTTP ${link.checkStatusCode}`;
      }
      return link.checkError || null;
    default:
      return null;
  }
}

export default function LinkCheckStatusRow({
  link,
}: {
  link: LinkIncludingShortenedCollectionAndTags;
}) {
  const { t } = useTranslation();

  if (!link.checkStatus || !link.lastCheckedAt) return null;

  const style = linkCheckStatusStyles[link.checkStatus];
  const detail = linkCheckDetail(t, link);

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
