import SettingsLayout from "@/layouts/SettingsLayout";
import { ReactElement, useEffect, useState } from "react";
import { useTranslation } from "next-i18next";
import { toast } from "react-hot-toast";
import Link from "next/link";
import clsx from "clsx";
import getServerSideProps from "@/lib/client/getServerSideProps";
import Checkbox from "@/components/Checkbox";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  linkCheckDetail,
  linkCheckStatusStyles,
} from "@/components/LinkCheckStatusRow";
import { useUpdateUserPreference, useUser } from "@linkwarden/router/user";
import { useConfig } from "@linkwarden/router/config";
import {
  LinkCheckerProblemLink,
  useLinkCheckerReport,
  useRecheckLinks,
} from "@linkwarden/router/linkChecker";
import { NextPageWithLayout } from "../_app";

const INTERVAL_OPTIONS = [1, 3, 7, 14, 30, 90];

const Page: NextPageWithLayout = () => {
  const { t } = useTranslation();
  const { data: account } = useUser() as any;
  const { data: config } = useConfig();
  const { data: report } = useLinkCheckerReport();
  const updateUserPreference = useUpdateUserPreference();
  const recheckLinks = useRecheckLinks();

  const [enabled, setEnabled] = useState<boolean>(
    account?.linkCheckerEnabled ?? true
  );
  const [intervalDays, setIntervalDays] = useState<number>(
    account?.linkCheckIntervalDays ?? 7
  );
  const [submitLoader, setSubmitLoader] = useState(false);

  useEffect(() => {
    if (account?.id) {
      setEnabled(account.linkCheckerEnabled ?? true);
      setIntervalDays(account.linkCheckIntervalDays ?? 7);
    }
  }, [account]);

  const instanceDisabled = config?.LINK_CHECKER_ENABLED === null;

  const brokenLinks =
    report?.problemLinks.filter((l) => l.checkStatus !== "RESTRICTED") ?? [];
  const restrictedLinks =
    report?.problemLinks.filter((l) => l.checkStatus === "RESTRICTED") ?? [];

  const hasChanges =
    !!account?.id &&
    (enabled !== (account.linkCheckerEnabled ?? true) ||
      intervalDays !== (account.linkCheckIntervalDays ?? 7));

  const intervalOptions = INTERVAL_OPTIONS.includes(intervalDays)
    ? INTERVAL_OPTIONS
    : [...INTERVAL_OPTIONS, intervalDays].sort((a, b) => a - b);

  const save = async () => {
    if (!hasChanges) return;

    setSubmitLoader(true);
    const load = toast.loading(t("applying_settings"));

    try {
      await updateUserPreference.mutateAsync({
        linkCheckerEnabled: enabled,
        linkCheckIntervalDays: intervalDays,
      });
      toast.success(t("settings_applied"));
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSubmitLoader(false);
      toast.dismiss(load);
    }
  };

  const recheck = async () => {
    const load = toast.loading(t("applying_settings"));

    try {
      await recheckLinks.mutateAsync();
      toast.success(t("links_queued_for_check"));
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      toast.dismiss(load);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <i className="bi-heart-pulse text-primary text-2xl"></i>
        <p className="capitalize text-3xl font-thin inline">
          {t("link_checker")}
        </p>
      </div>

      <Separator className="my-3" />

      <div className="flex flex-col gap-5">
        <p>{t("link_checker_desc")}</p>

        {instanceDisabled ? (
          <p className="text-neutral">{t("link_checker_disabled_instance")}</p>
        ) : (
          <div>
            <div className="mb-3">
              <Checkbox
                label={t("enable_link_checker")}
                state={enabled}
                onClick={() => setEnabled(!enabled)}
              />
            </div>

            <label
              className={clsx(
                "flex flex-wrap items-center gap-3 pl-1",
                !enabled && "opacity-50"
              )}
            >
              <span>{t("check_links_every")}</span>
              <select
                className="select select-bordered select-sm bg-base-200"
                value={intervalDays}
                disabled={!enabled}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
                data-testid="link-check-interval"
              >
                {intervalOptions.map((days) => (
                  <option key={days} value={days}>
                    {days === 1 ? t("one_day") : t("n_days", { count: days })}
                  </option>
                ))}
              </select>
            </label>

            <Button
              onClick={save}
              disabled={submitLoader || !hasChanges}
              className="mt-4 w-full sm:w-fit"
              variant="primary"
            >
              {t("save_changes")}
            </Button>
          </div>
        )}

        {report && (
          <div>
            <div className="flex items-center gap-2">
              <i className="bi-bar-chart text-primary text-2xl"></i>
              <p className="capitalize text-3xl font-thin inline">
                {t("link_status")}
              </p>
            </div>

            <Separator className="my-3" />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p data-testid="link-check-progress">
                  {t("links_checked_progress", {
                    checked: report.checked,
                    total: report.total,
                  })}
                </p>
                <p className="text-sm text-neutral">
                  {t("last_check")}:{" "}
                  {report.lastCheckedAt
                    ? new Date(report.lastCheckedAt).toLocaleString()
                    : t("never")}
                </p>
              </div>

              <Button
                variant="metal"
                onClick={recheck}
                disabled={
                  instanceDisabled ||
                  !account?.linkCheckerEnabled ||
                  recheckLinks.isPending ||
                  report.total === 0
                }
              >
                <i className="bi-arrow-clockwise"></i>
                {t("check_all_links_now")}
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              {(["OK", "BROKEN", "UNREACHABLE", "RESTRICTED"] as const).map(
                (status) => (
                  <div
                    key={status}
                    className="rounded-xl border border-neutral-content bg-base-200 p-3"
                    data-testid={`link-check-count-${status}`}
                  >
                    <p
                      className={clsx(
                        "flex items-center gap-1 text-sm",
                        linkCheckStatusStyles[status].color
                      )}
                    >
                      <i className={linkCheckStatusStyles[status].icon}></i>
                      {t(linkCheckStatusStyles[status].label)}
                    </p>
                    <p className="text-2xl font-thin">
                      {report.counts[status]}
                    </p>
                  </div>
                )
              )}
            </div>

            <p className="text-lg mt-6 mb-2">{t("problem_links")}</p>

            {brokenLinks.length === 0 ? (
              <p className="text-neutral">{t("no_problem_links")}</p>
            ) : (
              <ProblemLinksTable links={brokenLinks} testId="problem-links" />
            )}

            {restrictedLinks.length > 0 && (
              <>
                <p className="text-lg mt-6">{t("unverified_links")}</p>
                <p className="text-sm text-neutral mb-2">
                  {t("unverified_links_desc")}
                </p>
                <ProblemLinksTable
                  links={restrictedLinks}
                  testId="unverified-links"
                />
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
};

function ProblemLinksTable({
  links,
  testId,
}: {
  links: LinkCheckerProblemLink[];
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto">
      <table className="table" data-testid={testId}>
        <thead>
          <tr>
            <th>{t("name")}</th>
            <th>{t("link_status")}</th>
            <th>{t("collection")}</th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => {
            const style = linkCheckStatusStyles[link.checkStatus];

            return (
              <tr key={link.id}>
                <td className="max-w-xs">
                  <p className="truncate" title={link.name}>
                    {link.name || link.url}
                  </p>
                  {link.url && (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-neutral truncate block hover:opacity-70"
                      title={link.url}
                    >
                      {link.url}
                    </a>
                  )}
                </td>
                <td>
                  <p
                    className={clsx(
                      "flex items-center gap-1 whitespace-nowrap",
                      style.color
                    )}
                  >
                    <i className={style.icon}></i>
                    {t(style.label)}
                  </p>
                  <p className="text-xs text-neutral max-w-xs">
                    {linkCheckDetail(t, link)}
                  </p>
                  {link.checkStatus !== "RESTRICTED" &&
                    link.checkFailCount > 1 && (
                      <p className="text-xs text-neutral">
                        {t("failed_checks_in_a_row", {
                          count: link.checkFailCount,
                        })}
                      </p>
                    )}
                </td>
                <td>
                  <Link
                    href={`/collections/${link.collection.id}`}
                    className="hover:opacity-70"
                  >
                    {link.collection.name}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

Page.getLayout = function getLayout(page: ReactElement<any>) {
  return <SettingsLayout>{page}</SettingsLayout>;
};

export default Page;

export { getServerSideProps };
