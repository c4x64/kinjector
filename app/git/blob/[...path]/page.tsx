import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { codeToHtml } from "shiki";
import SiteNav from "@/components/SiteNav";
import RepoHeader from "@/components/git/RepoHeader";
import Breadcrumbs from "@/components/git/Breadcrumbs";
import CopyButton from "@/components/CopyButton";
import {
  BRANCH,
  REPO_URL,
  getBlob,
  getLocalBlob,
  getRepo,
  getTree,
  githubHref,
  logHref,
  rawHref,
} from "@/lib/git";

export const revalidate = 300;

type Props = { params: Promise<{ path: string[] }> };

const LANGS: Record<string, string> = {
  c: "c",
  h: "c",
  s: "asm",
  S: "asm",
  md: "markdown",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  css: "css",
  html: "html",
  sh: "bash",
  py: "python",
  zig: "zig",
  toml: "toml",
  rs: "rust",
  go: "go",
};

function languageFor(p: string): string {
  const base = p.split("/").pop() ?? "";
  if (base === "Makefile") return "make";
  if (base === "Dockerfile") return "docker";
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return LANGS[ext] ?? "text";
}

function bytes(n?: number): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path: segments } = await params;
  return { title: `${segments.join("/")} — kinjector` };
}

export default async function BlobPage({ params }: Props) {
  const { path: segments } = await params;
  const p = segments.join("/");

  const [repo, tree] = await Promise.all([getRepo(), getTree()]);
  const entry = tree?.entries.find((e) => e.path === p);

  const source = (await getBlob(p)) ?? (await getLocalBlob(p));

  if (source == null) {
    if (!entry) notFound();
    return (
      <>
        <SiteNav />
        <main className="wrap">
          <RepoHeader repo={repo} active="blob" />
          <div className="git-main git-main-wide">
            <Breadcrumbs path={p} />
            <div className="binary-panel">
              <div className="mono">binary file · {bytes(entry.size)}</div>
              <div className="panel-links">
                <a href={rawHref(p)}>raw</a>
                <a href={githubHref(p)} target="_blank" rel="noreferrer">
                  github ↗
                </a>
              </div>
            </div>
          </div>
        </main>
      </>
    );
  }

  const size = Buffer.byteLength(source);
  const lines = source.split("\n").length;
  const tooBig = size > 350_000;

  const html = tooBig
    ? null
    : await codeToHtml(source, {
        lang: languageFor(p),
        theme: "github-dark-default",
      });

  return (
    <>
      <SiteNav />

      <main className="wrap">
        <RepoHeader repo={repo} active="blob" />

        <div className="git-main git-main-wide">
          <Breadcrumbs path={p} />

          <div className="blob-bar">
            <span className="blob-meta mono">
              {lines} lines · {bytes(size)} · {BRANCH}
            </span>
            <div className="blob-actions">
              <CopyButton text={source} />
              <a className="copy" href={rawHref(p)}>
                raw
              </a>
              <Link className="copy" href={logHref(p)}>
                history
              </Link>
              <a
                className="copy"
                href={githubHref(p)}
                target="_blank"
                rel="noreferrer"
              >
                github ↗
              </a>
            </div>
          </div>

          <div className="blob">
            {html ? (
              <div
                className="code"
                // Shiki-rendered source of the file fetched above.
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <pre className="blob-plain">{source}</pre>
            )}
          </div>

          <p className="git-foot">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {REPO_URL.replace("https://", "")}
            </a>{" "}
            ·{" "}
            <Link href="/git/tree">back to tree</Link>
          </p>
        </div>
      </main>

      <div className="wrap">
        <footer>
          <div>kinjector · blob · main</div>
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
