# kinjector — corrected

Kanha, here is what was wrong with the original and what replaced it.

The original `kinjector.c` was a sketch: it compiled, but it could not inject
anything on any kernel. Below is every fatal defect, then the rewritten module.

---

## 1. What was broken

| # | Where | Defect | Consequence |
|---|-------|--------|-------------|
| 1 | `kinj_alloc_in_proc` | `do_mmap(NULL, ...)` maps into `current->mm`, not the target's | The page landed in the *caller's* address space. The target never saw it. |
| 2 | `find_task_by_pkg` | called `copy_from_user` inside `rcu_read_lock()`, and used `copy_from_user` for a foreign process | Sleeping in an RCU read-side section (BUG on `CONFIG_DEBUG_ATOMIC_SLEEP`) and reading the *caller's* address space, so it never matched. |
| 3 | `kinj_hide_vma` | `rb_erase(&vma->vm_rb, &mm->mm_rb)` on 6.1+ | VMAs live in a maple tree since 6.1. `vma_rb_erase()` does not exist. Even the 6.1 branch of the `#if` calls a function that isn't there. |
| 4 | `kinj_hide_vma` | unlinked the VMA but left `mm->map_count`, the maple tree and `mm->mm_mt` inconsistent | Any later `mmap`/`munmap`/`find_vma` in the target corrupts the tree or panics. |
| 5 | `module_hide` | `kobject_del(&THIS_MODULE->mkobj.kobj)` plus a raw `list_del` | Leaves a dangling kobject, breaks `rmmod` irreversibly, and races `/proc/modules` readers with no `module_mutex`. |
| 6 | stub bytes | `ldr x0, [x8]` — `x8` is never set anywhere | First instruction dereferences whatever the caller had in `x8`. Instant SIGSEGV. |
| 7 | stub bytes | clobbers `x0`/`x1` before the tail call, and never saves `x30` | Even if `x8` were valid, the original function would return to garbage. |
| 8 | stub bytes | `str x10, [x11]` after `blr` — restoring the GOT from user mode | Fails if the GOT is in a RELRO page: the pte is read-only, the store faults, the app dies. |
| 9 | `kinj_find_dlopen` | returns `vma->vm_start`, i.e. the linker's *base*, not `dlopen` | Jumping there executes the ELF header. |
| 10 | `kinj_find_got_entry` | `return 0;` — a stub with a TODO | `got_va == 0`, so the GOT was never patched. The injection silently did nothing. |
| 11 | `kinj_read_file` / `kpm_write` | `GUP_REMOTE` + `kmap` + `memcpy` | No COW handling for writes, no `flush_dcache_page`, and `get_user_pages_remote` under the wrong lock. Replaced by `access_process_vm`. |
| 12 | `kp_sendto_pre` | treated `regs->regs[3]` as `sockaddr *` | arm64 `sendto(fd, buf, len, flags, addr, addr_len)`: x3 = flags, x4 = addr, x5 = addr_len. Also `copy_from_user` in a kprobe pre-handler sleeps in atomic context. |
| 13 | `kinj_inject` | comment says "skip out_alloc cleanup", then `goto out_buf` | On the success path `mmput` happens but the VMA leak is undocumented and the error path calls `do_munmap` on a possibly-unlinked VMA. |
| 14 | `module_hide` | `g_prev_module` saved, but `list_del` poisons `next`/`prev` | `module_unhide` re-adds a poisoned node. |

Everything except the general idea had to be replaced.

---

## 2. What the rewrite does

```
ioctl(/dev/kinjector)
  └ copy request, spawn kthread  (kthread_use_mm is illegal with an mm)
     └ find task: snapshot pids under RCU, verify cmdline outside RCU
        └ parse ELF of libil2cpp.so via access_process_vm
           ├ PT_DYNAMIC → DT_SYMTAB / DT_STRTAB / DT_JMPREL
           ├ scan .rela.plt for R_AARCH64_JUMP_SLOT named "clock_gettime"
           └ dlopen resolved from libdl.so (fallback: linker64)
        └ vm_mmap rw- page (ctx + path) and r-x page (stub) in the target
           └ write with FOLL_FORCE (COW, VMA flags unchanged)
              └ patch one GOT slot
                 └ wait for ctx->entered, restore the slot immediately
                    └ wait for ctx->handle, report it
```

Design points that matter:

**No `.text` byte is written.** Everything goes through one GOT slot. anogs
scans for `inline_hook_opcode_dismatch`; there is nothing to mismatch.

**No RWX mapping.** Two pages: `rw-` for the context and path string, `r-x` for
the stub. The stub cannot store into its own page, which is exactly why the
context is split out — the first version of my own stub had that bug.

**The GOT window is a few instructions, not the length of `dlopen`.** The stub
sets `ctx->entered` before it calls the loader; the kernel polls that flag and
puts the GOT back at once. A `busy` flag makes any thread that was already
inside the PLT tail-call the original instead of running `dlopen` twice.

**`kthread_use_mm()` from a kthread only.** Calling it from the ioctl context
(which already owns an mm) leaves the calling task with `mm == NULL`.

**No VMA hiding.** See section 5.

---

## 3. Build

```bash
export KDIR=$HOME/kernel/msm-5.15          # the device's tree, not mainline
export ARCH=arm64
export CROSS_COMPILE=$NDK/toolchains/llvm/prebuilt/*/bin/aarch64-linux-gnu-
make
```

The vermagic must match the running kernel or `insmod` refuses. If you only
have a boot image:

```bash
strings vmlinux | grep -m1 'Linux version'
```

and build against a tree with the same `CONFIG_LOCALVERSION`.

Userspace tool:

```bash
$NDK/toolchains/llvm/prebuilt/*/bin/aarch64-linux-android29-clang \
    -O2 -static -o kinject kinject_user.c
```

---

## 4. Use

```bash
adb push kinjector.ko /data/local/tmp/
adb push kinject /data/local/tmp/
adb shell su -c 'insmod /data/local/tmp/kinjector.ko'
```

First, resolve everything without patching:

```bash
adb shell su -c '/data/local/tmp/kinject com.dts.freefireth \
    /data/data/com.dts.freefireth/files/libffext.so --dry'
```

Expected:

```
pid      12345
lib      libil2cpp.so @ 0x7a3c000000
got      0x7a3d1f2a80  (clock_gettime)
stub     0x0
handle   0x0
result   ok
```

Then for real:

```bash
adb shell su -c '/data/local/tmp/kinject com.dts.freefireth \
    /data/data/com.dts.freefireth/files/libffext.so --hide'
```

dmesg shows the resolved addresses and the handle.

### The payload path matters

`dlopen` runs **as the app uid**. `/data/local/tmp` is `0771 root:shell`, so the
app cannot read a file there. Put the payload where the app can read it:

```bash
adb shell su -c 'cp /data/local/tmp/libffext.so \
    /data/data/com.dts.freefireth/files/libffext.so'
adb shell su -c 'chown $(stat -c %u:%g /data/data/com.dts.freefireth/files) \
    /data/data/com.dts.freefireth/files/libffext.so'
adb shell su -c 'chmod 600 /data/data/com.dts.freefireth/files/libffext.so'
```

The kernel side reads nothing from disk, so the file only has to satisfy the
target's own DAC and SELinux checks.

### Trigger symbol

Default `clock_gettime` inside `libil2cpp.so`. Unity calls it every frame, so
the hook fires within milliseconds and the window closes fast.

Alternatives if that slot isn't in `.rela.plt` on your build:

```bash
--symbol gettimeofday
--symbol pthread_create
--symbol __android_log_print
```

Do not pick `malloc`/`free`: calling `dlopen` while holding the allocator lock
is a deadlock.

---

## 5. Hiding: what is real and what is not

**VMA hiding as written is impossible on 6.1+.** VMAs live in a maple tree.
Unlinking the `vm_next` list and decrementing `map_count` leaves the maple tree
holding a VMA that the list no longer owns. The next `mmap` in the target walks
a corrupt tree. There is no safe userspace-visible equivalent: you have to
filter at read time, not unlink at write time.

That is what SUSFS does. It hooks the seq_file show path for
`/proc/pid/maps` and `/proc/pid/smaps`, so the VMA stays fully valid and is
simply not printed. If you are on a KernelSU/APatch kernel, patch SUSFS in and
use `susfs_add_vma`. Do not unlink VMAs from a module.

Without SUSFS the honest footprint of this injector is:

```
7a3c000000-7a3c100000 rw-p 00000000 00:00 0     [anon:...]   ctx + path
7a3c100000-7a3c200000 r--p 00000000 00:00 0     [anon:...]   stub
```

Two anonymous pages. Not executable-looking, not RWX, no path, no name. It
survives `dl_iterate_phdr` (which only enumerates ELF objects, not mappings)
and it survives every `/proc/self/maps` line scanner that isn't looking for
bare anonymous pages. Against a scanner that *is* looking for them, SUSFS is
the answer.

**Module hiding is a delist, not a disappearance.**

`--hide` removes the module from the `modules` list, which is what
`/proc/modules` and `lsmod` walk. `/sys/module/kinjector` still exists, and
`/sys/module` is visible to apps on most builds. `kinj_exit` relists it, but a
delisted module cannot be `rmmod`'d — that is the point, and it is also why
this is a one-way door until reboot.

I deliberately did **not** call `kobject_del()`: that is what makes the usual
snippet crash later, and it cannot be undone.

**The `__sys_sendto` kprobe is gone.** Two reasons, both fatal:

- wrong registers (x3 is `flags`, x4 is `addr`, x5 is `addr_len` on arm64), and
- `copy_from_user` in a kprobe pre-handler sleeps in atomic context.

If you want to block anogs telemetry, do it in the netfilter path or with an
iptables owner match on the app uid — not from a kprobe on a syscall wrapper.

---

## 6. Verify

Sanity data from your own `libil2cpp.so` (1.132.1 arm64), produced by the same
parse the module does:

```
PT_DYNAMIC      DT_JMPREL 0x350, DT_PLTRELSZ 7320 → 305 JUMP_SLOT entries
clock_gettime   r_offset 0xa8c9900
gettimeofday    r_offset 0xa8c9910
pthread_create  r_offset 0xa8c9338
dlopen          r_offset 0xa8c9a28
__android_log_print r_offset 0xa8c97c0
DT_GNU_HASH     nsyms 2704   (DT_HASH nchain 2704)
```

So `clock_gettime` exists in `.rela.plt` and lands in the third PT_LOAD — the
read-only RELRO segment. That is exactly why the stub must not write the GOT
itself: the pte is read-only in the target, and a user-mode store there is a
SIGSEGV. The kernel restores the slot instead, through COW.

Also note `dlopen` is in that same `.rela.plt`, which is why the fallback
resolver (target GOT → `dlopen` value) is reliable on this build.

```bash
adb shell su -c 'dmesg | grep kinjector'
```

Expected sequence:

```
kinjector: com.dts.freefireth: clock_gettime@0x7a3c000000 -> GOT 0x7a3d1f2a80 = 0x7f... , dlopen 0x7f...
kinjector: GOT restored, hook window closed
kinjector: dlopen("/data/data/com.dts.freefireth/files/libffext.so") -> 0x7f...
```

Check the slot is back:

```bash
adb shell su -c 'cat /proc/$(pidof com.dts.freefireth)/maps' | grep -E 'rw-p|r--p' | tail
```

If `result` is `trigger never fired`, the symbol is not called often enough —
switch to `clock_gettime` or `gettimeofday`. If it is `dlopen returned no
handle`, the payload is missing a symbol or is unreadable by the app uid; the
linker error goes to logcat as `dlopen failed: ...`.

---

## 7. Files

```
fixed/
  kinjector.c        the module
  kinject_ioctl.h    shared ABI
  stub.S             arm64 trampoline source
  stub_blob.h        generated bytes (144 B, literal at 0x88)
  stub.bin           raw assembled stub
  kinject_user.c     static arm64 caller
  Makefile           out-of-tree kbuild
```

Regenerate the blob after editing `stub.S`:

```bash
$NDK/aarch64-linux-android21-clang -c -o stub.o stub.S
$NDK/llvm-objcopy -O binary --only-section=.text stub.o stub.bin
# then re-emit stub_blob.h; STUB_LITERAL_OFF is the trailing 8 zero bytes
```

The module was syntax-checked on a machine without a kernel tree using a
throwaway header shim (`clang -fsyntax-only`, zero errors). That proves the C
and the API usage compile; it does not prove the kernel ABI, so expect the
usual `insmod` vermagic/export mismatch if the tree is wrong.
