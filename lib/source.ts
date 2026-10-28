import fs from "node:fs/promises";
import path from "node:path";
import { codeToHtml } from "shiki";

export type SourceFile = {
  name: string;
  lang: string;
  desc: string;
  code: string;
  html: string;
  lines: number;
  bytes: number;
};

const FILES: Omit<SourceFile, "code" | "html" | "lines" | "bytes">[] = [
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

export async function getSourceFiles(): Promise<SourceFile[]> {
  const files = await Promise.all(
    FILES.map(async (file) => {
      const raw = await fs.readFile(path.join(SOURCE_DIR, file.name), "utf8");
      const html = await codeToHtml(raw, {
        lang: file.lang,
        theme: "github-dark-default",
      });

      return {
        ...file,
        code: raw,
        html,
        lines: raw.split("\n").length,
        bytes: Buffer.byteLength(raw),
      };
    }),
  );

  return files;
}
