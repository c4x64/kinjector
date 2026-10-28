import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteNav from "@/components/SiteNav";
import RepoHeader from "@/components/git/RepoHeader";
import CommitStrip from "@/components/git/CommitStrip";
import Breadcrumbs from "@/components/git/Breadcrumbs";
import TreeTable from "@/components/git/TreeTable";
import {
  REPO_URL,
  getLatestCommit,
  getLocalTree,
  getRepo,
  getTree,
  listDir,
} from "@/lib/git";

export const revalidate = 300;

type Props = { params: Promise<{ path?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path: segments } = await params;
  const dir = (segments ?? []).join("/");
  return {
    title: dir ? `${dir} — kinjector tree` : "tree — kinjector",
  };
}

export default async function TreePage({ params }: Props) {
  const { path: segments } = await params;
  const dir = (segments ?? []).join("/");

  const [repo, tree, latest] = await Promise.all([
    getRepo(),
    getTree(),
    getLatestCommit(),
  ]);

  const entries = tree ? tree.entries : await getLocalTree();
  const exists = dir ? entries.some((e) => e.path === dir && e.type === "tree") : true;
  if (!exists) notFound();

  return (
    <>
      <SiteNav />

      <main className="wrap">
        <RepoHeader repo={repo} active="tree" />

        {!tree ? (
          <div className="fallback-note">
            GitHub API unavailable — showing the deployed snapshot.
          </div>
        ) : null}

        <div className="git-main git-main-wide">
          <CommitStrip commit={latest} />
          <Breadcrumbs path={dir} />
          <TreeTable entries={listDir(entries, dir)} dir={dir} />

          <p className="git-foot">
            <Link href="/git/log">view commit log</Link> ·{" "}
            <a href={`${REPO_URL}/tree/main/${dir}`} target="_blank" rel="noreferrer">
              open on github ↗
            </a>
          </p>
        </div>
      </main>

      <div className="wrap">
        <footer>
          <div>kinjector · tree · main</div>
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
