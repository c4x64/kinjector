import Link from "next/link";
import { blobHref, treeHref, type DirEntry } from "@/lib/git";

function bytes(n?: number): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1.8 4.4c0-.8.6-1.4 1.4-1.4h3.1l1.5 1.7h5c.8 0 1.4.6 1.4 1.4v5.1c0 .8-.6 1.4-1.4 1.4H3.2c-.8 0-1.4-.6-1.4-1.4V4.4Z"
        fill="currentColor"
        opacity=".9"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M4 1.8h5l3 3v9.4H4V1.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M9 1.8v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export default function TreeTable({
  entries,
  dir,
}: {
  entries: DirEntry[];
  dir: string;
}) {
  const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";

  return (
    <div className="tree">
      <div className="tree-row tree-row-head">
        <span />
        <span>name</span>
        <span className="tree-size">size</span>
        <span className="tree-obj">object</span>
      </div>

      {dir ? (
        <Link className="tree-row" href={treeHref(parent)}>
          <span className="tree-icon" />
          <span className="tree-name tree-up">..</span>
          <span className="tree-size">—</span>
          <span className="tree-obj">—</span>
        </Link>
      ) : null}

      {entries.map((entry) => (
        <Link
          className="tree-row"
          key={entry.path}
          href={entry.type === "tree" ? treeHref(entry.path) : blobHref(entry.path)}
        >
          <span className={entry.type === "tree" ? "tree-icon tree-dir" : "tree-icon"}>
            {entry.type === "tree" ? <FolderIcon /> : <FileIcon />}
          </span>
          <span className="tree-name">{entry.name}</span>
          <span className="tree-size">
            {entry.type === "blob" ? bytes(entry.size) : "—"}
          </span>
          <span className="tree-obj">{entry.sha ? entry.sha.slice(0, 7) : "—"}</span>
        </Link>
      ))}

      {entries.length === 0 ? (
        <div className="tree-empty mono">empty directory</div>
      ) : null}
    </div>
  );
}
