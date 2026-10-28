import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteNav from "@/components/SiteNav";
import RepoHeader from "@/components/git/RepoHeader";
import DiffView from "@/components/git/DiffView";
import { REPO_URL, blobHref, getCommit, getRepo } from "@/lib/git";

export const revalidate = 300;

type Props = { params: Promise<{ sha: string }> };

const STATUS: Record<string, string> = {
  added: "A",
  modified: "M",
  removed: "D",
  renamed: "R",
  copied: "C",
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sha } = await params;
  const commit = await getCommit(sha);
  return {
    title: commit
      ? `${commit.sha.slice(0, 7)} ${commit.message} — kinjector`
      : "commit — kinjector",
  };
}

export default async function CommitPage({ params }: Props) {
  const { sha } = await params;
  const [repo, commit] = await Promise.all([getRepo(), getCommit(sha)]);

  if (!commit) notFound();

  return (
    <>
      <SiteNav />

      <main className="wrap">
        <RepoHeader repo={repo} active="commit" />

        <div className="git-main git-main-wide">
          <div className="commit-view">
            <div className="commit-top">
              <span className="commit-sha-full">{commit.sha}</span>
              <a
                className="copy"
                href={`${REPO_URL}/commit/${commit.sha}`}
                target="_blank"
                rel="noreferrer"
              >
                github ↗
              </a>
            </div>

            <h2 className="commit-subject">{commit.message}</h2>

            {commit.body ? <pre className="commit-body">{commit.body}</pre> : null}

            <div className="commit-meta">
              <span className="commit-author">{commit.authorName}</span>
              <span className="commit-dot">·</span>
              <time dateTime={commit.date}>{when(commit.date)}</time>
              {commit.parents.length ? (
                <>
                  <span className="commit-dot">·</span>
                  <span className="commit-parents">
                    parent{" "}
                    {commit.parents.map((p) => (
                      <Link key={p} href={`/git/commit/${p}`}>
                        {p.slice(0, 7)}
                      </Link>
                    ))}
                  </span>
                </>
              ) : null}
            </div>

            <div className="commit-stats">
              <span className="stat-add">+{commit.stats.additions}</span>
              <span className="stat-del">−{commit.stats.deletions}</span>
              <span className="stat-files">
                {commit.files.length} file{commit.files.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <div className="file-diffs">
            {commit.files.map((file) => (
              <details
                className="file-diff"
                key={file.filename}
                open={commit.files.length <= 3}
              >
                <summary>
                  <span className={`badge badge-${file.status}`}>
                    {STATUS[file.status] ?? "?"}
                  </span>
                  <Link
                    className="file-name"
                    href={blobHref(file.filename)}
                  >
                    {file.filename}
                  </Link>
                  <span className="file-add">+{file.additions}</span>
                  <span className="file-del">−{file.deletions}</span>
                </summary>

                {file.patch ? (
                  <DiffView patch={file.patch} />
                ) : (
                  <div className="no-patch mono">
                    binary file or diff too large — open on github
                  </div>
                )}
              </details>
            ))}
          </div>

          <p className="git-foot">
            <Link href="/git/log">← back to log</Link>
          </p>
        </div>
      </main>

      <div className="wrap">
        <footer>
          <div>kinjector · commit · {commit.sha.slice(0, 7)}</div>
          <div className="foot-links">
            <Link href="/git">git</Link>
            <Link href="/git/log">log</Link>
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
