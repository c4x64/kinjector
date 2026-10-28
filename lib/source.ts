import fs from "node:fs/promises";
import path from "node:path";
import { codeToHtml } from "shiki";

export const REPO_OWNER = "c4x64";
export const REPO_NAME = "kinjector";
export const REPO_BRANCH = "main";
export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
export const SOURCE_PATH = "source";

export type SourceOrigin = "github" | "local";

export type SourceFile = {
  name: string;
  lang: string;
  desc: string;
  code: string;
  html: string;
  lines: number;
  bytes: number;
  origin: SourceOrigin;
};

const FILES: Omit<SourceFile, "code" | "html" | "lines" | "bytes" | "origin">[] =
  [
    {
      name: "kinjector.c",
      lang: "c",
      desc: "kernel module — 1036 lines",
    },
    {
      name: "stub.S",
      lang: "asm",
      desc: "arm64 GOT trampoline",
    },
    {
      name: "kinject_ioctl.h",
      lang: "c",
      desc: "shared ioctl ABI",
    },
    {
      name: "kinject_user.c",
      lang: "c",
      desc: "static arm64 caller",
    },
    {
      name: "stub_blob.h",
      lang: "c",
      desc: "assembled stub bytes",
    },
    {
      name: "Makefile",
      lang: "make",
      desc: "out-of-tree kbuild",
    },
    {
      name: "README.md",
      lang: "markdown",
      desc: "audit and field notes",
    },
  ];

const SOURCE_DIR = path.join(process.cwd(), "source");

function rawUrl(name: string) {
  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${SOURCE_PATH}/${name}`;
}

/**
 * Read one file from the repository. On Vercel the build machine (and the
 * /git route) fetches it straight from GitHub; a local copy is the fallback so
 * a build never fails because the network is down.
 */
async function readOne(name: string): Promise<{ code: string; origin: SourceOrigin }> {
  try {
    const res = await fetch(rawUrl(name), { next: { revalidate: 300 } });
    if (res.ok) {
      return { code: await res.text(), origin: "github" };
    }
  } catch {
    // fall through to the bundled copy
  }

  return {
    code: await fs.readFile(path.join(SOURCE_DIR, name), "utf8"),
    origin: "local",
  };
}

export async function getSourceFiles(): Promise<SourceFile[]> {
  return Promise.all(
    FILES.map(async (file) => {
      const { code, origin } = await readOne(file.name);
      const html = await codeToHtml(code, {
        lang: file.lang,
        theme: "github-dark-default",
      });

      return {
        ...file,
        code,
        html,
        origin,
        lines: code.split("\n").length,
        bytes: Buffer.byteLength(code),
      };
    }),
  );
}
