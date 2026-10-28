import Link from "next/link";
import { REPO_NAME, REPO_OWNER, type RepoInfo } from "@/lib/git";

const TABS = [
  { id: "summary", label: "summary", href: "/git" },
  { id: "tree", label: "tree", href: "/git/tree" },
  { id: "log", label: "log", href: "/git/log" },
] as const;

export default function RepoHeader({
  repo,
  active,
}: {
  repo: RepoInfo | null;
  active: "summary" | "tree" | "log" | "commit" | "blob";
}) {
  return (
    <header className="repo-head">
      <div className="repo-title-row">
        <h1 className="repo-title">
          <Link href="/git">{REPO_OWNER}</Link>
          <span className="repo-slash">/</span>
          <b>{REPO_NAME}</b>
        </h1>
        <span className="chip">public</span>
        <span className="chip chip-live">
          <span className="chip-dot" />
          main
        </span>
      </div>

      {repo?.description ? <p className="repo-desc">{repo.description}</p> : null}

      <nav className="repo-tabs" aria-label="Repository views">
        {TABS.map((tab) => {
          const isActive =
            tab.id === active || (active === "blob" && tab.id === "tree");
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={isActive ? "repo-tab repo-tab-active" : "repo-tab"}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
        <a
          className="repo-tab repo-tab-ext"
          href={`https://github.com/${REPO_OWNER}/${REPO_NAME}`}
          target="_blank"
          rel="noreferrer"
        >
          github ↗
        </a>
      </nav>
    </header>
  );
}
