# kinjector

Kernel-assisted GOT trampoline injector for Android arm64.

Loads a userspace ELF payload into a running process by pointing a single
`R_AARCH64_JUMP_SLOT` GOT entry at a 144-byte trampoline, then restoring the
slot as soon as the target enters it.

- No `.text` byte is written.
- No RWX mapping: `rw-` context page, `r-x` stub page.
- The kernel restores the GOT entry; user mode never writes into RELRO.
- No VMA unlinking — impossible to do safely on 6.1+ (maple tree).

## Layout

```
source/           the module, stub, ABI, caller, Makefile
app/              the site (Next.js, static content)
components/       source browser and copy controls
lib/              reads source/ at build time
```

## Site

The Next.js app at the repo root is deployed at
[kinjector.vercel.app](https://kinjector.vercel.app). The home page reads
`source/`, while [`/git`](https://kinjector.vercel.app/git) fetches the same
files from GitHub at request time and revalidates every five minutes.

```bash
npm install
npm run dev
npm run build
```

## Build the module

```bash
export KDIR=$HOME/kernel/msm-5.15
export ARCH=arm64
export CROSS_COMPILE=$NDK/toolchains/llvm/prebuilt/*/bin/aarch64-linux-gnu-
make -C source
```

Full field notes, the 14-defect audit, and the load procedure are in
[`source/README.md`](source/README.md).

## Colophon

![Kanha](public/krishna.png)

Kanha — the name behind the build.
