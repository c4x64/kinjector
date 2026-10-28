import type { Metadata } from "next";
import CodeViewer from "@/components/CodeViewer";
import SiteNav from "@/components/SiteNav";
import { getSourceFiles, REPO_URL } from "@/lib/source";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "git — kinjector",
  description:
    "Live source browser for c4x64/kinjector, fetched from GitHub on every revalidation.",
};

export default async function GitPage() {
  const files = await getSourceFiles();
  const lines = files.reduce((n, f) => n + f.lines, 0);
  const live = files.every((f) => f.origin === "github");

  return (
    <>
      <SiteNav />

      <main>
        <div className="wrap">
          <section className="git-head">
            <div className="eyebrow">git / source browser</div>

            <h1 className="git-title">
              c4x64/<em>kinjector</em>
            </h1>

            <p className="git-sub">
              Fetched from <code>raw.githubusercontent.com</code> at request
              time and cached for five minutes. What you read here is the
              branch, not a bundled copy.
            </p>

            <div className="chips">
              <span className="chip">main</span>
              <span className={live ? "chip chip-live" : "chip"}>
                <span className="chip-dot" />
                {live ? "live from github" : "bundled fallback"}
              </span>
              <span className="chip">
                {files.length} files · {lines} lines
              </span>
              <a
                className="chip chip-link"
                href={`${REPO_URL}/tree/main/source`}
                target="_blank"
                rel="noreferrer"
              >
                open on github ↗
              </a>
            </div>
          </section>

          <CodeViewer files={files} />

          <p className="git-foot">
            source/ · branch main · revalidated every 300s ·{" "}
            <a href="/">back to the module</a>
          </p>
        </div>
      </main>

      <div className="wrap">
        <footer>
          <div>kinjector · fetched from github · main</div>
          <div className="foot-links">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              github
            </a>
            <a href="/">home</a>
            <a href="/git">git</a>
          </div>
        </footer>
      </div>
    </>
  );
}
