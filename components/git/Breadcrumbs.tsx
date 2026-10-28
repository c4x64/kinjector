import Link from "next/link";
import { REPO_NAME, REPO_OWNER, treeHref } from "@/lib/git";

export default function Breadcrumbs({ path }: { path: string }) {
  const parts = path ? path.split("/") : [];

  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link className="crumb-root" href={treeHref()}>
        {REPO_OWNER}/{REPO_NAME}
      </Link>
      {parts.map((part, i) => {
        const sub = parts.slice(0, i + 1).join("/");
        const last = i === parts.length - 1;
        return (
          <span className="crumb-seg" key={sub}>
            <span className="crumb-sep">/</span>
            {last ? (
              <span className="crumb-current">{part}</span>
            ) : (
              <Link href={treeHref(sub)}>{part}</Link>
            )}
          </span>
        );
      })}
      {parts.length === 0 ? <span className="crumb-sep">/</span> : null}
    </nav>
  );
}
