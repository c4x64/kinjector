import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

export const REPO_OWNER = "c4x64";
export const REPO_NAME = "kinjector";
export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
export const BRANCH = "main";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

const IGNORED = new Set([
  "node_modules",
  ".next",
  ".git",
  ".vercel",
  ".DS_Store",
  "next-env.d.ts",
]);

export type RepoInfo = {
  full_name: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  pushed_at: string;
  html_url: string;
};

export type TreeEntry = {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
};

export type CommitItem = {
  sha: string;
  message: string;
  authorName: string;
  date: string;
  login: string | null;
  avatar: string | null;
};

export type CommitFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};

export type CommitDetail = CommitItem & {
  body: string;
  htmlUrl: string;
  stats: { total: number; additions: number; deletions: number };
  files: CommitFile[];
  parents: string[];
};

export type DirEntry = {
  name: string;
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
};

type GhCommit = {
  sha: string;
  html_url?: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  author?: { login: string; avatar_url: string } | null;
  parents?: { sha: string }[];
  stats?: { total: number; additions: number; deletions: number };
  files?: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }[];
};

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "kinjector-site",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function gh<T>(pathname: string, revalidate = 300): Promise<T | null> {
  try {
    const res = await fetch(`${API}${pathname}`, {
      headers: authHeaders(),
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export function treeHref(p?: string): string {
  return p ? `/git/tree/${encodePath(p)}` : "/git/tree";
}

export function blobHref(p: string): string {
  return `/git/blob/${encodePath(p)}`;
}

export function logHref(p?: string, page?: number): string {
  const q = new URLSearchParams();
  if (p) q.set("path", p);
  if (page && page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/git/log?${s}` : "/git/log";
}

export function rawHref(p: string, ref = BRANCH): string {
  return `${RAW}/${REPO_OWNER}/${REPO_NAME}/${ref}/${encodePath(p)}`;
}

export function githubHref(p?: string, ref = BRANCH): string {
  const base = `${REPO_URL}/${p ? "blob" : "tree"}/${ref}`;
  return p ? `${base}/${encodePath(p)}` : base;
}

export async function getRepo(): Promise<RepoInfo | null> {
  return gh<RepoInfo>(`/repos/${REPO_OWNER}/${REPO_NAME}`);
}

export async function getTree(
  ref = BRANCH,
): Promise<{ entries: TreeEntry[]; sha: string } | null> {
  const data = await gh<{ sha: string; tree: TreeEntry[]; truncated?: boolean }>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  if (!data) return null;
  return {
    sha: data.sha,
    entries: data.tree.filter((e) => !e.path.split("/").some((seg) => IGNORED.has(seg))),
  };
}

function toCommitItem(c: GhCommit): CommitItem {
  return {
    sha: c.sha,
    message: c.commit.message,
    authorName: c.commit.author?.name ?? "unknown",
    date: c.commit.author?.date ?? "",
    login: c.author?.login ?? null,
    avatar: c.author?.avatar_url ?? null,
  };
}

export async function getLatestCommit(
  ref = BRANCH,
): Promise<CommitItem | null> {
  const list = await gh<GhCommit[]>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/commits?sha=${encodeURIComponent(ref)}&per_page=1`,
  );
  return list && list[0] ? toCommitItem(list[0]) : null;
}

export async function getCommits(opts: {
  ref?: string;
  path?: string;
  page?: number;
  perPage?: number;
}): Promise<CommitItem[] | null> {
  const { ref = BRANCH, path: p, page = 1, perPage = 30 } = opts;
  const q = new URLSearchParams({
    sha: ref,
    per_page: String(perPage),
    page: String(page),
  });
  if (p) q.set("path", p);

  const list = await gh<GhCommit[]>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/commits?${q.toString()}`,
  );
  return list ? list.map(toCommitItem) : null;
}

export async function getCommit(sha: string): Promise<CommitDetail | null> {
  const c = await gh<GhCommit>(`/repos/${REPO_OWNER}/${REPO_NAME}/commits/${sha}`);
  if (!c) return null;

  const message = c.commit.message;
  const [first, ...rest] = message.split("\n");

  return {
    ...toCommitItem(c),
    message: first,
    body: rest.join("\n").trim(),
    htmlUrl: c.html_url ?? `${REPO_URL}/commit/${c.sha}`,
    stats: c.stats ?? { total: 0, additions: 0, deletions: 0 },
    files: c.files ?? [],
    parents: (c.parents ?? []).map((p) => p.sha),
  };
}

/** Directory listing derived from the recursive tree. */
export function listDir(entries: TreeEntry[], dir: string): DirEntry[] {
  const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
  const out: DirEntry[] = [];

  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const rest = entry.path.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    out.push({
      name: rest,
      path: entry.path,
      type: entry.type,
      size: entry.size,
      sha: entry.sha,
    });
  }

  return out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function getBlob(p: string, ref = BRANCH): Promise<string | null> {
  try {
    const res = await fetch(
      `${RAW}/${REPO_OWNER}/${REPO_NAME}/${encodeURIComponent(ref)}/${encodePath(p)}`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return null;
    const text = await res.text();
    if (text.includes("\u0000")) return null;
    return text;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- fallback */

type LocalEntry = { path: string; type: "blob" | "tree"; size?: number; sha: string };

async function walk(dir: string, rel = "", depth = 0): Promise<LocalEntry[]> {
  if (depth > 6) return [];
  const out: LocalEntry[] = [];
  let items: Dirent[];

  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const item of items) {
    if (IGNORED.has(item.name) || item.name.startsWith(".")) continue;
    const abs = path.join(dir, item.name);
    const childRel = rel ? `${rel}/${item.name}` : item.name;

    if (item.isDirectory()) {
      out.push({ path: childRel, type: "tree", sha: "" });
      out.push(...(await walk(abs, childRel, depth + 1)));
    } else {
      const stat = await fs.stat(abs).catch(() => null);
      out.push({
        path: childRel,
        type: "blob",
        size: stat?.size,
        sha: "",
      });
    }
  }

  return out;
}

export async function getLocalTree(): Promise<TreeEntry[]> {
  return walk(process.cwd());
}

export async function getLocalBlob(p: string): Promise<string | null> {
  try {
    const root = process.cwd();
    const abs = path.resolve(/* turbopackIgnore: true */ root, p);
    if (!abs.startsWith(root + path.sep)) return null;
    if (p.split("/").some((seg) => IGNORED.has(seg))) return null;
    const text = await fs.readFile(abs, "utf8");
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

export function relativeTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
