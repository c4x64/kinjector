import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import SiteNav from "@/components/SiteNav";
import RepoHeader from "@/components/git/RepoHeader";
import {
  REPO_URL,
  getCommits,
  getRepo,
  logHref,
  relativeTime,
} from "@/lib/git";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "log — kinjector",
  description: "Commit history for c4x64/kinjector.",
};

type Props = {
  searchParams: Promise<{ path?: string; page?: string }>;
};

function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function LogPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filter = typeof sp.path === "string" && sp.path ? sp.path : undefined;
  const page = Math.max(
    1,
    Math.min(50, Number.parseInt(sp.page ?? "1", 10) || 1),
  );

  const [repo, commits] = await Promise.all([
    getRepo(),
    getCommits({ path: filter, page }),
  ]);

  const PER_PAGE = 30;
  let lastDay = "";

  return (
    <>
      <SiteNav />

      <main className="wrap">
        <RepoHeader repo={repo} active="log" />

        <div className="git-main git-main-wide">
          <div className="log-head">
            <div>
              <span className="mono log-label">commits</span>
              {filter ? (
                <Link className="log-filter" href={logHref()}>
                  {filter} ✕
                </Link>
              ) : (
                <span className="chip">main</span>
              )}
            </div>
            <span className="mono log-count">
              {commits ? `${commits.length} on this page` : "unavailable"}
            </span>
          </div>

          {!commits ? (
            <div className="fallback-note">
              GitHub API unavailable — the commit log cannot be read right now.
            </div>
          ) : (
            <div className="log">
              {commits.map((c) => {
                const d = day(c.date);
                const showDay = d !== lastDay;
                lastDay = d;

                return (
                  <Fragment key={c.sha}>
                    {showDay ? <div className="log-day">{d}</div> : null}
                    <Link className="log-row" href={`/git/commit/${c.sha}`}>
                      <span className="log-sha">{c.sha.slice(0, 7)}</span>
                      <span className="log-msg">{c.message.split("\n")[0]}</span>
                      <span className="log-author">
                        {c.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.avatar} alt="" width={18} height={18} />
                        ) : (
                          <span className="log-avatar">
                            {c.authorName.slice(0, 1)}
                          </span>
                        )}
                        {c.authorName}
                      </span>
                      <span className="log-when">{relativeTime(c.date)}</span>
                    </Link>
                  </Fragment>
                );
              })}
            </div>
          )}

          <div className="log-pager">
            {page > 1 ? (
              <Link className="copy" href={logHref(filter, page - 1)}>
                ← newer
              </Link>
            ) : (
              <span />
            )}
            {commits && commits.length === PER_PAGE ? (
              <Link className="copy" href={logHref(filter, page + 1)}>
                older →
              </Link>
            ) : null}
          </div>

          <p className="git-foot">
            <a href={`${REPO_URL}/commits/main`} target="_blank" rel="noreferrer">
              full history on github ↗
            </a>
          </p>
        </div>
      </main>

      <div className="wrap">
        <footer>
          <div>kinjector · log · main</div>
          <div className="foot-links">
            <Link href="/git">git</Link>
            <Link href="/git/tree">tree</Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              github
            </a>
            <Link href="/">home</Link>
          </div>
        </footer>
      </div>
    </>
  );
}
