import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import RepoHeader from "@/components/git/RepoHeader";
import CommitStrip from "@/components/git/CommitStrip";
import Breadcrumbs from "@/components/git/Breadcrumbs";
import TreeTable from "@/components/git/TreeTable";
import CopyButton from "@/components/CopyButton";
import {
  REPO_URL,
  getLatestCommit,
  getLocalTree,
  getRepo,
  getTree,
  listDir,
  relativeTime,
} from "@/lib/git";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "git — kinjector",
  description:
    "Repository browser for c4x64/kinjector: tree, blobs, commit log, all fetched from GitHub.",
};

export default async function GitSummary() {
  const [repo, tree, latest] = await Promise.all([
    getRepo(),
    getTree(),
    getLatestCommit(),
  ]);

  const entries = tree ? tree.entries : await getLocalTree();
  const live = Boolean(tree);
  const clone = `git clone ${REPO_URL}.git`;

  return (
    <>
      <SiteNav />

      <main className="wrap">
        <RepoHeader repo={repo} active="summary" />

        {!live ? (
          <div className="fallback-note">
            GitHub API unavailable right now — showing the deployed snapshot.
          </div>
        ) : null}

        <div className="git-layout">
          <div className="git-main">
            <CommitStrip commit={latest} />
            <Breadcrumbs path="" />
            <TreeTable entries={listDir(entries, "")} dir="" />
          </div>

          <aside className="git-aside">
            <section className="panel">
              <h2>clone</h2>
              <pre className="clone">{clone}</pre>
              <CopyButton text={clone} label="copy" />
            </section>

            <section className="panel">
              <h2>about</h2>
              <p>
                {repo?.description ??
                  "Kernel-assisted GOT trampoline injector for Android arm64."}
              </p>
              <dl className="props">
                <div>
                  <dt>branch</dt>
                  <dd>main</dd>
                </div>
                <div>
                  <dt>stars</dt>
                  <dd>{repo?.stargazers_count ?? "—"}</dd>
                </div>
                <div>
                  <dt>last push</dt>
                  <dd>{repo ? relativeTime(repo.pushed_at) : "—"}</dd>
                </div>
              </dl>
            </section>

            <section className="panel">
              <h2>views</h2>
              <div className="panel-links">
                <Link href="/git/tree">tree</Link>
                <Link href="/git/log">log</Link>
                <a href={REPO_URL} target="_blank" rel="noreferrer">
                  github ↗
                </a>
              </div>
            </section>
          </aside>
        </div>
      </main>

      <div className="wrap">
        <footer>
          <div>kinjector · fetched from github · main</div>
          <div className="foot-links">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              github
            </a>
            <Link href="/">home</Link>
            <Link href="/git">git</Link>
          </div>
        </footer>
      </div>
    </>
  );
}
