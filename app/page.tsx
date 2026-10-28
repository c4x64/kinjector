import Image from "next/image";
import CopyButton from "@/components/CopyButton";
import CodeViewer from "@/components/CodeViewer";
import SiteNav from "@/components/SiteNav";
import { getSourceFiles, REPO_URL } from "@/lib/source";

function Cmd({ title, children }: { title: string; children: string }) {
  return (
    <div className="cmd">
      <div className="cmd-head">
        <span>{title}</span>
        <CopyButton text={children} />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export default async function Page() {
  const files = await getSourceFiles();

  return (
    <>
      <SiteNav />

      <main id="top">
        {/* ------------------------------------------------------------ hero */}
        <div className="wrap">
          <section className="hero" style={{ borderBottom: "none" }}>
            <div className="fade-list">
              <div className="eyebrow">kernel module · arm64 · android</div>

              <h1 className="title">
                kinjector<em>.</em>
              </h1>

              <p className="hero-sub">
                A GOT trampoline injector that never writes a byte of{" "}
                <strong>.text</strong>.
              </p>

              <p className="hero-copy">
                Loads a userspace payload into a running Android process from a
                kernel module: one PLT slot, two anonymous pages, and a hook
                window measured in instructions.
              </p>

              <div className="hero-actions">
                <a className="btn btn-primary" href="#source">
                  Browse source
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M8 2v12M3.5 9.5 8 14l4.5-4.5" />
                  </svg>
                </a>
                <a className="btn btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer">
                  Repository
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M5 11 11 5M6 5h5v5" />
                  </svg>
                </a>
              </div>
            </div>

            <div className="term" aria-label="Injection trace">
              <div className="term-bar">
                <span className="dot" />
                <span className="dot" />
                <span className="dot live" />
                <span className="term-title">kinjector — /dev/kinjector</span>
              </div>
              <div className="term-body" role="img" aria-label="dry run and real run output">
                <div className="row"><span className="t-prompt">$ </span><span className="t-cmd">insmod kinjector.ko</span></div>
                <div className="row"><span className="t-prompt">$ </span><span className="t-cmd">kinject com.dts.freefireth …/libhgloader.so --dry</span></div>
                <div className="t-gap" />
                <div className="row"><span className="t-key">  pid      </span><span className="t-val">18422</span></div>
                <div className="row"><span className="t-key">  lib      </span><span className="t-val">libil2cpp.so @ 0x7a3c000000</span></div>
                <div className="row"><span className="t-key">  got      </span><span className="t-val">0x7a3d1f2a80</span><span className="t-dim">  clock_gettime</span></div>
                <div className="row"><span className="t-key">  stub     </span><span className="t-val">0x7a3c100000</span></div>
                <div className="row"><span className="t-key">  result   </span><span className="t-ok">ok</span></div>
                <div className="t-gap" />
                <div className="row"><span className="t-prompt">$ </span><span className="t-cmd">kinject com.dts.freefireth …/libhgloader.so --hide</span></div>
                <div className="t-gap" />
                <div className="row"><span className="t-dim">  kinjector: </span><span className="t-ok">GOT restored</span><span className="t-dim">, hook window closed</span></div>
                <div className="row"><span className="t-dim">  kinjector: dlopen(</span><span className="t-val">&quot;libhgloader.so&quot;</span><span className="t-dim">) -&gt; </span><span className="t-val">0x7f4c2a1000</span></div>
                <div className="t-gap" />
                <div className="row"><span className="t-dim">  # two anonymous pages, no RWX, no name</span></div>
              </div>
            </div>
          </section>
        </div>

        <div className="wrap">
          <div className="stats">
            <div className="stat">
              <b>1036</b>
              <span>lines of C</span>
            </div>
            <div className="stat">
              <b>144 B</b>
              <span>stub, assembled</span>
            </div>
            <div className="stat">
              <b>2</b>
              <span>anonymous pages</span>
            </div>
            <div className="stat">
              <b>0</b>
              <span>.text bytes written</span>
            </div>
          </div>
        </div>

        {/* -------------------------------------------------------- mechanism */}
        <div className="wrap">
          <section id="mechanism">
            <div className="section-head">
              <div className="kicker">
                <b>01</b> / mechanism
              </div>
              <div>
                <h2>One slot, held open for a few instructions.</h2>
                <p>
                  The module does not patch code. It resolves a single
                  <code> R_AARCH64_JUMP_SLOT </code> entry, points it at a
                  144-byte trampoline, and puts it back as soon as the target
                  enters the stub.
                </p>
              </div>
            </div>

            <div className="steps">
              <article className="step">
                <div className="step-num">01 / RESOLVE</div>
                <h3>Find the task and the slot</h3>
                <p>
                  Snapshot pids under RCU, verify <code>cmdline</code> outside
                  it, then parse <code>PT_DYNAMIC</code> and{" "}
                  <code>.rela.plt</code> through <code>access_process_vm</code>.
                </p>
              </article>

              <article className="step">
                <div className="step-num">02 / MAP</div>
                <h3>Two pages, W^X split</h3>
                <p>
                  <code>kthread_use_mm</code> plus <code>vm_mmap</code>: a{" "}
                  <code>rw-</code> page for the context and path, an{" "}
                  <code>r-x</code> page for the stub. No RWX mapping exists.
                </p>
              </article>

              <article className="step">
                <div className="step-num">03 / PATCH</div>
                <h3>Swap one GOT entry</h3>
                <p>
                  Write with <code>FOLL_FORCE</code> so COW handles the RELRO
                  page. Every other byte of the target stays untouched.
                </p>
              </article>

              <article className="step">
                <div className="step-num">04 / FIRE</div>
                <h3>Enter, load, restore</h3>
                <p>
                  The stub sets <code>ctx-&gt;entered</code>, calls{" "}
                  <code>dlopen</code> once, and tail-calls the original. The
                  kernel restores the slot immediately.
                </p>
              </article>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------------ constraints */}
        <div className="wrap">
          <section id="constraints">
            <div className="section-head">
              <div className="kicker">
                <b>02</b> / constraints
              </div>
              <div>
                <h2>What it refuses to do.</h2>
                <p>
                  Most of the work in this rewrite was deleting tricks that
                  cannot be made safe. The module is smaller because of it.
                </p>
              </div>
            </div>

            <div className="grid-2">
              <article className="card">
                <h3>
                  No .text writes <span className="tag good">by design</span>
                </h3>
                <p>
                  anogs compares hooked prologues against the on-disk image.
                  This injector has no prologue to compare: the only modified
                  word is a GOT slot, and only while it is being entered.
                </p>
              </article>

              <article className="card">
                <h3>
                  No RWX <span className="tag good">W^X</span>
                </h3>
                <p>
                  The context lives on a writable, non-executable page. The stub
                  lives on an executable, read-only page. The stub cannot store
                  into itself — that is why the two pages are separate.
                </p>
              </article>

              <article className="card">
                <h3>
                  No long hook window <span className="tag good">instant</span>
                </h3>
                <p>
                  <code>ctx-&gt;entered</code> is the handshake. The kernel polls
                  it, restores the slot, then waits for{" "}
                  <code>ctx-&gt;handle</code>. A <code>busy</code> flag makes
                  concurrent callers tail-call the original instead of loading
                  twice.
                </p>
              </article>

              <article className="card">
                <h3>
                  No VMA hiding <span className="tag bad">not possible on 6.1+</span>
                </h3>
                <p>
                  VMAs moved to the maple tree. Unlinking <code>vm_rb</code> used
                  to be a crash waiting to happen; now it does not even compile.
                  Filter the maps read path with SUSFS, or accept two anonymous
                  pages.
                </p>
              </article>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------------------ build */}
        <div className="wrap">
          <section id="build">
            <div className="section-head">
              <div className="kicker">
                <b>03</b> / build &amp; load
              </div>
              <div>
                <h2>Match the tree, then dry-run.</h2>
                <p>
                  The vermagic has to match the running kernel or{" "}
                  <code>insmod</code> refuses the module. Build against the
                  device tree, not mainline.
                </p>
              </div>
            </div>

            <div className="build">
              <div className="col">
                <div>
                  <h3>Kernel module</h3>
                  <p className="note">Out-of-tree kbuild against the device tree.</p>
                  <Cmd title="shell">{String.raw`export KDIR=$HOME/kernel/msm-5.15
export ARCH=arm64
export CROSS_COMPILE=$NDK/toolchains/llvm/prebuilt/*/bin/aarch64-linux-gnu-
make`}</Cmd>
                </div>

                <div>
                  <h3>Userspace caller</h3>
                  <p className="note">Static arm64 binary, no runtime deps.</p>
                  <Cmd title="shell">{String.raw`$NDK/toolchains/llvm/prebuilt/*/bin/aarch64-linux-android29-clang \
  -O2 -static -o kinject kinject_user.c`}</Cmd>
                </div>
              </div>

              <div className="col">
                <div>
                  <h3>Load and resolve</h3>
                  <p className="note">
                    Always run <code>--dry</code> first: it resolves the pid,
                    library, GOT slot and stub base without patching anything.
                  </p>
                  <Cmd title="shell">{String.raw`adb push kinjector.ko kinject /data/local/tmp/
adb shell su -c 'insmod /data/local/tmp/kinjector.ko'
adb shell su -c '/data/local/tmp/kinject com.dts.freefireth \
  /data/data/com.dts.freefireth/files/libhgloader.so --dry'`}</Cmd>
                </div>

                <div className="callout">
                  <b>Payload path matters.</b> <code>dlopen</code> runs as the
                  app uid. <code>/data/local/tmp</code> is{" "}
                  <code>0771 root:shell</code>, so the app cannot read a file
                  there. Copy the payload into{" "}
                  <code>/data/data/&lt;pkg&gt;/files/</code> and chown it to the
                  app uid before injecting.
                </div>

                <div>
                  <h3>Inject</h3>
                  <Cmd title="shell">{String.raw`adb shell su -c '/data/local/tmp/kinject com.dts.freefireth \
  /data/data/com.dts.freefireth/files/libhgloader.so --hide'`}</Cmd>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------------------ audit */}
        <div className="wrap">
          <section id="audit">
            <div className="section-head">
              <div className="kicker">
                <b>04</b> / audit
              </div>
              <div>
                <h2>Fourteen reasons the first sketch could not work.</h2>
                <p>
                  The original <code>kinjector.c</code> compiled and did
                  nothing. Each row below is a defect that was reproduced,
                  documented, and replaced.
                </p>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Where</th>
                    <th>Defect</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="idx">01</td>
                    <td className="file">kinj_alloc_in_proc</td>
                    <td className="res">
                      <code>do_mmap(NULL, …)</code> maps into the caller&apos;s
                      mm. The target never saw the page.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">02</td>
                    <td className="file">find_task_by_pkg</td>
                    <td className="res">
                      <code>copy_from_user</code> inside{" "}
                      <code>rcu_read_lock</code>, and against the wrong address
                      space. Never matched, and slept in atomic context.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">03</td>
                    <td className="file">kinj_hide_vma</td>
                    <td className="res">
                      <code>rb_erase</code> on VMAs that live in a maple tree
                      since 6.1. The function does not exist.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">04</td>
                    <td className="file">kinj_hide_vma</td>
                    <td className="res">
                      Unlinking left <code>map_count</code> and{" "}
                      <code>mm_mt</code> inconsistent. The next{" "}
                      <code>mmap</code> in the target corrupts the tree.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">05</td>
                    <td className="file">module_hide</td>
                    <td className="res">
                      <code>kobject_del</code> plus a raw <code>list_del</code>{" "}
                      leaves a dangling kobject and breaks <code>rmmod</code>{" "}
                      forever.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">06</td>
                    <td className="file">stub bytes</td>
                    <td className="res">
                      <code>ldr x0, [x8]</code> with <code>x8</code> never set.
                      The first instruction dereferences whatever the caller
                      held.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">07</td>
                    <td className="file">stub bytes</td>
                    <td className="res">
                      Clobbered <code>x0</code>/<code>x1</code> before the tail
                      call and never saved <code>x30</code>.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">08</td>
                    <td className="file">stub bytes</td>
                    <td className="res">
                      <code>str</code> back into a RELRO GOT from user mode.
                      Read-only PTE, instant SIGSEGV.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">09</td>
                    <td className="file">kinj_find_dlopen</td>
                    <td className="res">
                      Returned <code>vma-&gt;vm_start</code> — the linker base,
                      not <code>dlopen</code>.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">10</td>
                    <td className="file">kinj_find_got_entry</td>
                    <td className="res">
                      <code>return 0;</code> with a TODO. The GOT was never
                      patched, so injection silently did nothing.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">11</td>
                    <td className="file">kinj_read_file</td>
                    <td className="res">
                      <code>GUP_REMOTE</code> + <code>kmap</code> +{" "}
                      <code>memcpy</code>: no COW handling, no cache flush.
                      Replaced by <code>access_process_vm</code>.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">12</td>
                    <td className="file">kp_sendto_pre</td>
                    <td className="res">
                      Treated <code>x3</code> as <code>sockaddr *</code>. On
                      arm64 it is <code>flags</code>; <code>x4</code> is the
                      address. Also slept in a kprobe.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">13</td>
                    <td className="file">kinj_inject</td>
                    <td className="res">
                      The error path called <code>do_munmap</code> on a possibly
                      unlinked VMA.
                    </td>
                  </tr>
                  <tr>
                    <td className="idx">14</td>
                    <td className="file">module_hide</td>
                    <td className="res">
                      <code>list_del</code> poisons <code>next</code>/
                      <code>prev</code>; <code>module_unhide</code> re-added a
                      poisoned node.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* ----------------------------------------------------------- source */}
        <div className="wrap">
          <section id="source">
            <div className="section-head">
              <div className="kicker">
                <b>05</b> / source
              </div>
              <div>
                <h2>The whole module, in the repo.</h2>
                <p>
                  Every file the module is built from, fetched from the GitHub
                  repository. The dedicated browser at{" "}
                  <a href="/git" style={{ color: "var(--accent)" }}>
                    /git
                  </a>{" "}
                  pulls the same files at request time, so it always matches the
                  branch.
                </p>
              </div>
            </div>

            <CodeViewer files={files} />

            <p
              className="mono"
              style={{
                marginTop: 16,
                fontSize: 11.5,
                color: "var(--dimmer)",
              }}
            >
              {files.reduce((n, f) => n + f.lines, 0)} lines across{" "}
              {files.length} files ·{" "}
              <a
                href={`${REPO_URL}/tree/main/source`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--dim)" }}
              >
                source/ on GitHub ↗
              </a>
            </p>
          </section>
        </div>

        {/* --------------------------------------------------------- colophon */}
        <div className="wrap">
          <section id="colophon" className="colophon">
            <figure className="portrait">
              <div className="portrait-frame">
                <Image
                  src="/krishna.png"
                  alt="Vintage lithograph of Krishna playing the flute"
                  width={1000}
                  height={1000}
                  sizes="(max-width: 760px) 220px, 300px"
                />
              </div>
              <figcaption>
                <span>Kanha</span>
                <span className="deva">कान्हा</span>
              </figcaption>
            </figure>

            <div className="colophon-copy">
              <div className="kicker">
                <b>06</b> / colophon
              </div>
              <h2>One device. One kernel tree.</h2>
              <p>
                This was not written for a compatibility matrix. It was written
                against one phone, one running kernel, and one payload — then
                audited line by line until everything that could not be made
                safe was removed.
              </p>
              <p>
                The print is Kanha, the name behind the build.
              </p>
              <p className="sig">— Kanha</p>
            </div>
          </section>
        </div>
      </main>

      <div className="wrap">
        <footer>
          <div>
            kinjector · arm64 · GKI 5.10 – 6.1 · built for a device, not a
            whitepaper
          </div>
          <div className="foot-links">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              github
            </a>
            <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer">
              readme
            </a>
            <a href="#colophon">colophon</a>
            <a href="#top">top ↑</a>
          </div>
        </footer>
      </div>
    </>
  );
}
