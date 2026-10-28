import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "next-i18next";
import { useConfig } from "@linkwarden/router/config";
import { useLinkCheckerReport } from "@linkwarden/router/linkChecker";

const DISMISSED_KEY = "linkCheckerNoticeDismissedCount";

// Points the user to the link checker report when some of their links stopped
// working. Dismissing it hides it until more links break.
export default function BrokenLinksNotice() {
  const { t } = useTranslation();
  const { data: config } = useConfig();
  const { data: report } = useLinkCheckerReport();
  const [dismissedCount, setDismissedCount] = useState<number | null>(null);

  useEffect(() => {
    try {
      setDismissedCount(Number(localStorage.getItem(DISMISSED_KEY)) || 0);
    } catch {
      setDismissedCount(0);
    }
  }, []);

  if (!config?.LINK_CHECKER_ENABLED || !report || dismissedCount === null)
    return null;

  const count = report.counts.BROKEN + report.counts.UNREACHABLE;

  if (count === 0 || count <= dismissedCount) return null;

  const dismiss = () => {
    setDismissedCount(count);
    try {
      localStorage.setItem(DISMISSED_KEY, String(count));
    } catch {}
  };

  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-error/40 bg-error/10 px-4 py-2 text-sm"
      data-testid="broken-links-notice"
    >
      <i className="bi-exclamation-triangle-fill text-error text-lg leading-none" />
      <p className="grow">
        {count === 1
          ? t("broken_links_notice_singular")
          : t("broken_links_notice_plural", { count })}{" "}
        <Link
          href="/settings/link-checker"
          className="font-semibold underline underline-offset-4 hover:opacity-70"
        >
          {t("review_links")}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="text-neutral hover:opacity-70 duration-100"
        aria-label={t("hide")}
      >
        <i className="bi-x text-lg leading-none" />
      </button>
    </div>
  );
}
