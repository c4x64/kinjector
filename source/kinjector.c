// SPDX-License-Identifier: GPL-2.0
// ================================================================
//  kinjector.c — kernel-space .so injector for Android arm64
//
//  Rewritten. The original sketch could not work: it mapped into the
//  caller's mm, slept under rcu_read_lock, erased a maple-tree VMA with
//  rb_erase and jumped into a stub that read a register nobody set.
//
//  What this version does, in order:
//
//    1. ioctl -> copy request -> spawn a short-lived kthread.
//       (A kthread is required: kthread_use_mm() is illegal from a
//        task that already owns an mm.)
//    2. kthread snapshots the process list under RCU, drops RCU, then
//       verifies each candidate by reading its cmdline with
//       access_process_vm — no sleeping inside RCU.
//    3. Resolves the target library's load bias by parsing its ELF
//       headers through access_process_vm.
//    4. Parses PT_DYNAMIC, finds the .rela.plt slot for the requested
//       symbol, and reads the current GOT value.
//    5. kthread_use_mm(target_mm) + vm_mmap to get two anonymous pages
//       inside the target: one rw- for the context, one r-x for the
//       stub. No RWX: an anonymous RWX VMA is the loudest footprint
//       you can leave. The stub cannot store into its own r-x page, so
//       the mutable half lives in the rw- page.
//    6. Writes both pages with FOLL_FORCE, which COWs them without
//       changing the VMA flags.
//    7. Writes the stub address into the GOT slot, waits for the stub's
//       `entered` flag, and puts the GOT back from the kernel. The
//       window is a few instructions wide, not the length of dlopen.
//       A busy flag makes any thread that was already inside the PLT
//       tail-call the original instead of running dlopen twice.
//    8. Polls ctx->handle for the dlopen result, with a timeout.
//
//  No .text byte is modified anywhere, so anogs' inline-hook opcode
//  scan has nothing to find.
//
//  Build: out-of-tree against the device kernel tree.
// ================================================================

#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>
#include <linux/fs.h>
#include <linux/miscdevice.h>
#include <linux/uaccess.h>
#include <linux/slab.h>
#include <linux/sched.h>
#include <linux/sched/mm.h>
#include <linux/sched/signal.h>
#include <linux/sched/task.h>
#include <linux/mmu_context.h>
#include <linux/mm.h>
#include <linux/mman.h>
#include <linux/kthread.h>
#include <linux/completion.h>
#include <linux/delay.h>
#include <linux/mutex.h>
#include <linux/elf.h>
#include <linux/version.h>
#include <linux/vmalloc.h>
#include <linux/pid.h>
#include <linux/capability.h>

#include "kinject_ioctl.h"
#include "stub_blob.h"

#define KINJ_TAG "kinjector: "

// bionic values; the kernel has no dlfcn.h
#ifndef RTLD_NOW
#  define RTLD_NOW    2
#endif
#ifndef RTLD_GLOBAL
#  define RTLD_GLOBAL 0x100
#endif

// ---------------------------------------------------------------- compat

#if LINUX_VERSION_CODE >= KERNEL_VERSION(5, 8, 0)
#  define KINJ_MMAP_RLOCK(mm)   mmap_read_lock(mm)
#  define KINJ_MMAP_RUNLOCK(mm) mmap_read_unlock(mm)
#  define KINJ_USE_MM(mm)       kthread_use_mm(mm)
#  define KINJ_UNUSE_MM(mm)     kthread_unuse_mm(mm)
#else
#  define KINJ_MMAP_RLOCK(mm)   down_read(&(mm)->mmap_sem)
#  define KINJ_MMAP_RUNLOCK(mm) up_read(&(mm)->mmap_sem)
#  define KINJ_USE_MM(mm)       use_mm(mm)
#  define KINJ_UNUSE_MM(mm)     unuse_mm(mm)
#endif

#ifndef R_AARCH64_JUMP_SLOT
#  define R_AARCH64_JUMP_SLOT 1026
#endif

#ifndef DT_GNU_HASH
#  define DT_GNU_HASH 0x6ffffef5
#endif

#ifndef FOLL_FORCE
#  define FOLL_FORCE 0x08
#endif

#define KINJ_MAX_DYN   256
#define KINJ_MAX_SYMS  65536
#define KINJ_SCAN_SYMS 8192        // bound when no hash table is present
#define KINJ_MAX_TASKS 1024
#define KINJ_MAX_PHDR  64

// the target gets two mappings:
//   rw-  ctx (mutable) + path string
//   r-x  stub only
// a store from the stub into an r-x page would fault, hence the split
#define KINJ_CTX_OFF   0x000
#define KINJ_PATH_OFF  0x100
#define KINJ_PAGE_SZ   0x1000

struct kinj_ctx {
    __u64 path_ptr;      // +0x00  rw page
    __u64 flags;         // +0x08
    __u64 dlopen_va;     // +0x10
    __u64 handle;        // +0x18
    __u64 orig_fn;       // +0x20
    __u32 entered;       // +0x28
    __u32 busy;          // +0x2c
};

struct kinj_lib {
    unsigned long bias;
    unsigned long start;
    unsigned long end;
};

struct kinj_elf {
    struct kinj_lib lib;
    unsigned long dyn_va;
    unsigned long symtab;     // absolute
    unsigned long strtab;     // absolute
    unsigned long strsz;
    unsigned long jmprel;     // absolute
    unsigned long pltrelsz;
    long          pltrel;     // DT_RELA / DT_REL
    unsigned long hash_va;    // DT_HASH
    unsigned long gnu_hash_va;// DT_GNU_HASH
    unsigned long nsyms;      // 0 when unknown
};

// ------------------------------------------------------------- module hide
//
// Only the module list is touched: /proc/modules is generated by walking
// it. kobject_del() is deliberately NOT called — it tears down sysfs state
// and is what makes the usual "hide module" snippets crash on unload.
// The pointers are kept valid so this is reversible.

static DEFINE_MUTEX(g_hide_lock);
static struct list_head *g_prev, *g_next;
static bool g_hidden;

static void kinj_hide_module(void)
{
    struct module *m = THIS_MODULE;

    mutex_lock(&g_hide_lock);
    if (!g_hidden) {
        g_prev = m->list.prev;
        g_next = m->list.next;
        g_prev->next = g_next;
        g_next->prev = g_prev;
        g_hidden = true;
    }
    mutex_unlock(&g_hide_lock);
    pr_info(KINJ_TAG "module delisted from /proc/modules\n");
}

static void kinj_show_module(void)
{
    struct module *m = THIS_MODULE;

    mutex_lock(&g_hide_lock);
    if (g_hidden) {
        m->list.next = g_next;
        m->list.prev = g_prev;
        g_next->prev = &m->list;
        g_prev->next = &m->list;
        g_hidden = false;
    }
    mutex_unlock(&g_hide_lock);
    pr_info(KINJ_TAG "module relisted\n");
}

// ------------------------------------------------------- target r/w layer

static int kinj_apv(struct task_struct *t, unsigned long va,
                    void *buf, int len, bool write)
{
#if LINUX_VERSION_CODE >= KERNEL_VERSION(5, 0, 0)
    unsigned int gup = write ? (FOLL_WRITE | FOLL_FORCE) : 0;

    return access_process_vm(t, va, buf, len, gup);
#else
    return access_process_vm(t, va, buf, len, write ? 1 : 0);
#endif
}

static int kinj_read(struct task_struct *t, unsigned long va,
                     void *buf, size_t len)
{
    size_t done = 0;

    while (done < len) {
        int n = kinj_apv(t, va + done, (char *)buf + done,
                         min_t(size_t, len - done, INT_MAX), false);
        if (n <= 0)
            return -EFAULT;
        done += n;
    }
    return 0;
}

static int kinj_write(struct task_struct *t, unsigned long va,
                      const void *buf, size_t len)
{
    size_t done = 0;

    while (done < len) {
        int n = kinj_apv(t, va + done, (void *)((const char *)buf + done),
                         min_t(size_t, len - done, INT_MAX), true);
        if (n <= 0)
            return -EFAULT;
        done += n;
    }
    return 0;
}

// ------------------------------------------------------------ task lookup

static int kinj_cmdline_matches(struct task_struct *t, const char *pkg)
{
    struct mm_struct *mm;
    unsigned long a, b;
    char buf[PKG_NAME_MAX];
    size_t len, n;

    mm = get_task_mm(t);
    if (!mm)
        return 0;

    a = READ_ONCE(mm->arg_start);
    b = READ_ONCE(mm->arg_end);
    len = b > a ? min_t(unsigned long, b - a, sizeof(buf) - 1) : 0;
    mmput(mm);

    if (!len)
        return 0;

    if (kinj_read(t, a, buf, len))
        return 0;
    buf[len] = '\0';

    n = strnlen(buf, len);
    if (n < strlen(pkg))
        return 0;
    if (strncmp(buf, pkg, strlen(pkg)))
        return 0;

    return (buf[strlen(pkg)] == '\0' || buf[strlen(pkg)] == ':');
}

static struct task_struct *kinj_find_task(const char *pkg)
{
    struct task_struct **arr;
    struct task_struct *t, *found = NULL;
    int n = 0, i;

    arr = kcalloc(KINJ_MAX_TASKS, sizeof(*arr), GFP_KERNEL);
    if (!arr)
        return NULL;

    rcu_read_lock();
    for_each_process(t) {
        if (n >= KINJ_MAX_TASKS)
            break;
        if (t->flags & PF_KTHREAD)
            continue;
        if (!READ_ONCE(t->mm))
            continue;
        get_task_struct(t);
        arr[n++] = t;
    }
    rcu_read_unlock();

    for (i = 0; i < n; i++) {
        if (!found && kinj_cmdline_matches(arr[i], pkg))
            found = arr[i];
        else
            put_task_struct(arr[i]);
    }
    kfree(arr);
    return found;
}

// --------------------------------------------------------------- ELF walk

static int kinj_find_lib(struct mm_struct *mm, const char *name,
                         struct kinj_lib *out)
{
    struct vm_area_struct *vma;
    unsigned long addr = 0;

    // find_vma() hides whether the kernel uses the old rbtree/list or the
    // maple tree (6.1+), and is exported on every version we target.
    KINJ_MMAP_RLOCK(mm);
    while ((vma = find_vma(mm, addr)) != NULL) {
        const char *fn;

        addr = vma->vm_end;

        if (!vma->vm_file || vma->vm_pgoff != 0)
            continue;
        fn = vma->vm_file->f_path.dentry->d_name.name;
        if (!fn || strcmp(fn, name))
            continue;
        out->bias  = vma->vm_start;
        out->start = vma->vm_start;
        out->end   = vma->vm_end;
        KINJ_MMAP_RUNLOCK(mm);
        return 0;
    }
    KINJ_MMAP_RUNLOCK(mm);
    return -ENOENT;
}

static unsigned long kinj_gnu_hash_nsyms(struct task_struct *t,
                                         unsigned long hv);

static int kinj_elf_open(struct task_struct *t, struct mm_struct *mm,
                         const char *libname, struct kinj_elf *e)
{
    Elf64_Ehdr eh;
    Elf64_Phdr *ph = NULL;
    Elf64_Dyn *dyn = NULL;
    unsigned long best = 0;
    int i, ret = -EINVAL, ndyn = 0;

    memset(e, 0, sizeof(*e));

    if (kinj_find_lib(mm, libname, &e->lib))
        return -ENOENT;

    if (kinj_read(t, e->lib.bias, &eh, sizeof(eh)))
        return -EFAULT;

    if (memcmp(eh.e_ident, ELFMAG, SELFMAG) ||
        eh.e_ident[EI_CLASS] != ELFCLASS64 ||
        eh.e_ident[EI_DATA]  != ELFDATA2LSB ||
        eh.e_machine != EM_AARCH64 ||
        eh.e_type != ET_DYN)
        return -EINVAL;

    if (!eh.e_phnum || eh.e_phnum > KINJ_MAX_PHDR ||
        eh.e_phentsize != sizeof(Elf64_Phdr))
        return -EINVAL;

    ph = kcalloc(eh.e_phnum, sizeof(*ph), GFP_KERNEL);
    if (!ph)
        return -ENOMEM;

    if (kinj_read(t, e->lib.bias + eh.e_phoff,
                  ph, eh.e_phnum * sizeof(*ph))) {
        ret = -EFAULT;
        goto out;
    }

    for (i = 0; i < eh.e_phnum; i++) {
        if (ph[i].p_type == PT_LOAD) {
            unsigned long v = e->lib.bias + ph[i].p_vaddr;
            unsigned long end = v + ph[i].p_memsz;

            if (!best || v < best)
                best = v;
            if (end > e->lib.end)
                e->lib.end = end;
        }
        if (ph[i].p_type == PT_DYNAMIC) {
            e->dyn_va = e->lib.bias + ph[i].p_vaddr;
            ndyn = min_t(unsigned long, ph[i].p_memsz / sizeof(Elf64_Dyn),
                         KINJ_MAX_DYN);
        }
    }

    // the mapping we found is the one at file offset 0, so bias is exact
    e->lib.start = best ? best : e->lib.bias;

    if (!e->dyn_va) {
        ret = -EINVAL;
        goto out;
    }
    if (!ndyn) {
        ret = -EINVAL;
        goto out;
    }

    // dyn[] used to live on the stack (256 * 16 bytes), which trips the
    // 2048-byte frame limit on 5.10/5.15. Keep it on the heap instead.
    dyn = kvmalloc_array(ndyn, sizeof(*dyn), GFP_KERNEL);
    if (!dyn) {
        ret = -ENOMEM;
        goto out;
    }

    if (kinj_read(t, e->dyn_va, dyn, ndyn * sizeof(*dyn))) {
        ret = -EFAULT;
        goto out;
    }

    for (i = 0; i < ndyn; i++) {
        if (dyn[i].d_tag == DT_NULL)
            break;
        switch (dyn[i].d_tag) {
        case DT_SYMTAB:
            e->symtab = e->lib.bias + dyn[i].d_un.d_ptr;
            break;
        case DT_STRTAB:
            e->strtab = e->lib.bias + dyn[i].d_un.d_ptr;
            break;
        case DT_STRSZ:
            e->strsz = dyn[i].d_un.d_val;
            break;
        case DT_JMPREL:
            e->jmprel = e->lib.bias + dyn[i].d_un.d_ptr;
            break;
        case DT_PLTRELSZ:
            e->pltrelsz = dyn[i].d_un.d_val;
            break;
        case DT_PLTREL:
            e->pltrel = dyn[i].d_un.d_val;
            break;
        case DT_HASH:
            e->hash_va = e->lib.bias + dyn[i].d_un.d_ptr;
            break;
        case DT_GNU_HASH:
            e->gnu_hash_va = e->lib.bias + dyn[i].d_un.d_ptr;
            break;
        default:
            break;
        }
    }

    if (e->gnu_hash_va)
        e->nsyms = kinj_gnu_hash_nsyms(t, e->gnu_hash_va);

    if (!e->nsyms && e->hash_va) {
        __u32 hdr[2];

        if (!kinj_read(t, e->hash_va, hdr, sizeof(hdr)))
            e->nsyms = hdr[1];
    }

    if (!e->symtab || !e->strtab || !e->strsz) {
        ret = -EINVAL;
        goto out;
    }

    ret = 0;
out:
    kfree(ph);
    kvfree(dyn);
    return ret;
}

// GNU hash gives an exact dynamic symbol count. Layout:
//   u32 nbuckets, symoffset, bloom_size, bloom_shift
//   u64 bloom[bloom_size]
//   u32 buckets[nbuckets]
//   u32 chain[...]      index = symidx - symoffset, bit 0 = end of chain
static unsigned long kinj_gnu_hash_nsyms(struct task_struct *t,
                                         unsigned long hv)
{
    __u32 hdr[4];
    __u32 *buckets;
    unsigned long boff, maxsym = 0, n = 0, i;

    if (kinj_read(t, hv, hdr, sizeof(hdr)))
        return 0;
    if (!hdr[0] || hdr[0] > 65536 || hdr[2] > 65536)
        return 0;

    boff = hv + 16 + (unsigned long)hdr[2] * 8;
    buckets = kvmalloc_array(hdr[0], sizeof(__u32), GFP_KERNEL);
    if (!buckets)
        return 0;
    if (kinj_read(t, boff, buckets, (size_t)hdr[0] * sizeof(__u32))) {
        kvfree(buckets);
        return 0;
    }
    for (i = 0; i < hdr[0]; i++)
        if (buckets[i] > maxsym)
            maxsym = buckets[i];
    kvfree(buckets);

    if (maxsym < hdr[1])
        return hdr[1];

    for (i = 0; i < KINJ_MAX_SYMS; i++) {
        __u32 v;
        unsigned long coff = boff + (unsigned long)hdr[0] * 4 +
                             (maxsym - hdr[1] + i) * 4;

        if (kinj_read(t, coff, &v, sizeof(v)))
            return 0;
        if (v & 1) {
            n = maxsym + i + 1;
            break;
        }
    }
    return n;
}

static int kinj_sym_name(struct task_struct *t, const struct kinj_elf *e,
                         const Elf64_Sym *sym, char *out, size_t cap)
{
    size_t n;

    if (sym->st_name >= e->strsz || cap < 2)
        return -EINVAL;

    n = min_t(size_t, e->strsz - sym->st_name, cap - 1);
    if (kinj_read(t, e->strtab + sym->st_name, out, n))
        return -EFAULT;
    out[n] = '\0';

    // reject anything that is not a terminated printable symbol name
    if (n > 0 && strnlen(out, n) == 0)
        return -EINVAL;
    return 0;
}

static int kinj_resolve_sym(struct task_struct *t, struct mm_struct *mm,
                            const char *libname, const char *symname,
                            unsigned long *va_out)
{
    struct kinj_elf e;
    Elf64_Sym sym;
    char name[128];
    unsigned long n, lim;
    int ret;

    ret = kinj_elf_open(t, mm, libname, &e);
    if (ret)
        return ret;

    lim = e.nsyms ? min_t(unsigned long, e.nsyms, KINJ_MAX_SYMS)
                  : KINJ_SCAN_SYMS;

    for (n = 0; n < lim; n++) {
        unsigned long sa = e.symtab + n * sizeof(Elf64_Sym);

        if (kinj_read(t, sa, &sym, sizeof(sym)))
            return -EFAULT;
        if (!sym.st_name)
            continue;
        if (kinj_sym_name(t, &e, &sym, name, sizeof(name)))
            continue;
        if (strcmp(name, symname))
            continue;
        if (!sym.st_value)
            continue;
        *va_out = e.lib.bias + sym.st_value;
        return 0;
    }
    return -ENOENT;
}

static int kinj_find_got(struct task_struct *t, struct mm_struct *mm,
                         const char *libname, const char *symname,
                         unsigned long *got_out, unsigned long *orig_out,
                         unsigned long *bias_out)
{
    struct kinj_elf e;
    Elf64_Rela *rela = NULL;
    Elf64_Sym sym;
    char name[128];
    unsigned long cnt, i;
    int ret;

    ret = kinj_elf_open(t, mm, libname, &e);
    if (ret)
        return ret;

    if (bias_out)
        *bias_out = e.lib.bias;

    if (!e.jmprel || !e.pltrelsz)
        return -ENOENT;
    if (e.pltrel != DT_RELA)
        return -EOPNOTSUPP;

    cnt = e.pltrelsz / sizeof(Elf64_Rela);
    if (!cnt || cnt > 100000)
        return -EINVAL;

    rela = kvmalloc_array(cnt, sizeof(*rela), GFP_KERNEL);
    if (!rela)
        return -ENOMEM;

    if (kinj_read(t, e.jmprel, rela, cnt * sizeof(*rela))) {
        ret = -EFAULT;
        goto out;
    }

    ret = -ENOENT;
    for (i = 0; i < cnt; i++) {
        unsigned long symidx = ELF64_R_SYM(rela[i].r_info);
        unsigned long sa;

        if (ELF64_R_TYPE(rela[i].r_info) != R_AARCH64_JUMP_SLOT)
            continue;
        if (!symidx)
            continue;

        sa = e.symtab + symidx * sizeof(Elf64_Sym);
        if (kinj_read(t, sa, &sym, sizeof(sym)))
            continue;
        if (kinj_sym_name(t, &e, &sym, name, sizeof(name)))
            continue;
        if (strcmp(name, symname))
            continue;

        *got_out = e.lib.bias + rela[i].r_offset;
        if (kinj_read(t, *got_out, orig_out, sizeof(*orig_out))) {
            ret = -EFAULT;
            goto out;
        }
        if (*orig_out < PAGE_SIZE || *orig_out >= TASK_SIZE) {
            pr_warn(KINJ_TAG "%s: GOT slot 0x%lx holds 0x%lx, not a "
                    "resolved pointer\n", symname, *got_out, *orig_out);
            ret = -ENOENT;
            goto out;
        }
        ret = 0;
        break;
    }
out:
    kvfree(rela);
    return ret;
}

// -------------------------------------------------------- target mapping

static unsigned long kinj_map(struct mm_struct *mm, size_t size,
                              unsigned long prot)
{
    unsigned long addr;

    // the caller is a kthread: current->mm is NULL, so this is legal
    mmget(mm);
    KINJ_USE_MM(mm);
    addr = vm_mmap(NULL, 0, size, prot, MAP_PRIVATE | MAP_ANONYMOUS, 0);
    KINJ_UNUSE_MM(mm);
    mmput(mm);

    if (IS_ERR_VALUE(addr))
        return 0;
    return addr;
}

static void kinj_unmap(struct mm_struct *mm, unsigned long addr, size_t size)
{
    mmget(mm);
    KINJ_USE_MM(mm);
    vm_munmap(addr, size);
    KINJ_UNUSE_MM(mm);
    mmput(mm);
}

// ------------------------------------------------------------- injection

// dlopen has to be resolved in the target's own address space. Three
// sources, in order of reliability:
//   1. libdl.so's dynsym   — bionic's stub, always present when the app
//                            links libdl (Unity does)
//   2. the target lib's own GOT — if libil2cpp imports dlopen, that slot
//                            already holds the resolved address
//   3. linker64's dynsym   — only on older releases; 10+ hides dlopen and
//                            exports __loader_dlopen instead, which takes
//                            an extra argument and must not be used here
static int kinj_find_dlopen(struct task_struct *t, struct mm_struct *mm,
                            const char *target_lib, unsigned long *out)
{
    unsigned long slot = 0, val = 0;
    int ret;

    ret = kinj_resolve_sym(t, mm, "libdl.so", "dlopen", out);
    if (!ret)
        return 0;

    ret = kinj_find_got(t, mm, target_lib, "dlopen", &slot, &val, NULL);
    if (!ret && val) {
        *out = val;
        return 0;
    }

    ret = kinj_resolve_sym(t, mm, "linker64", "dlopen", out);
    if (!ret)
        return 0;

    return -ENOENT;
}

static int kinj_do_inject(struct kinject_req *req)
{
    struct task_struct *task;
    struct mm_struct *mm;
    struct kinj_ctx ctx;
    unsigned long dlopen_va = 0, got_va = 0, orig_got = 0, bias = 0;
    unsigned long page_rw = 0, page_rx = 0;
    unsigned long ctx_va = 0, stub_va = 0, path_va = 0;
    size_t path_len;
    int ret = 0, i, budget;
    bool armed = false, hit = false;

    if (!req->pkg_name[0] || !req->so_path[0])
        return -EINVAL;

    // the struct came from userspace; never trust the terminators
    req->pkg_name[PKG_NAME_MAX - 1]   = '\0';
    req->so_path[SO_PATH_MAX - 1]     = '\0';
    req->target_lib[LIB_NAME_MAX - 1] = '\0';
    req->hook_symbol[SYM_NAME_MAX - 1] = '\0';

    if (strnlen(req->so_path, SO_PATH_MAX) >= SO_PATH_MAX)
        return -EINVAL;
    path_len = strlen(req->so_path) + 1;
    if (path_len > KINJ_PAGE_SZ - KINJ_PATH_OFF)
        return -EINVAL;

    if (!req->target_lib[0])
        strscpy(req->target_lib, "libil2cpp.so", LIB_NAME_MAX);
    if (!req->hook_symbol[0])
        strscpy(req->hook_symbol, "clock_gettime", SYM_NAME_MAX);

    if (!req->timeout_ms)
        req->timeout_ms = 3000;
    if (req->timeout_ms > 30000)
        req->timeout_ms = 30000;

    task = kinj_find_task(req->pkg_name);
    if (!task) {
        req->result = KINJ_E_NO_TASK;
        return -ESRCH;
    }
    req->task_pid = task_pid_nr(task);

    mm = get_task_mm(task);
    if (!mm) {
        ret = -EINVAL;
        req->result = KINJ_E_NO_MM;
        goto out_task;
    }

#ifdef TIF_32BIT
    if (test_tsk_thread_flag(task, TIF_32BIT)) {
        ret = -ENOTSUPP;
        req->result = KINJ_E_32BIT;
        goto out_mm;
    }
#endif

    // 1. dlopen in the target address space
    ret = kinj_find_dlopen(task, mm, req->target_lib, &dlopen_va);
    if (ret) {
        pr_err(KINJ_TAG "dlopen not found (%d)\n", ret);
        req->result = KINJ_E_NO_DLOPEN;
        goto out_mm;
    }

    // 2. GOT slot for the trigger symbol
    ret = kinj_find_got(task, mm, req->target_lib, req->hook_symbol,
                        &got_va, &orig_got, &bias);
    if (ret) {
        pr_err(KINJ_TAG "GOT slot for %s in %s not found (%d)\n",
               req->hook_symbol, req->target_lib, ret);
        req->result = KINJ_E_NO_SYMBOL;
        goto out_mm;
    }
    req->lib_base = bias;
    req->got_va = got_va;

    pr_info(KINJ_TAG "%s: %s@0x%lx -> GOT 0x%lx = 0x%lx, dlopen 0x%lx\n",
            req->pkg_name, req->hook_symbol, bias, got_va, orig_got,
            dlopen_va);

    if (req->flags & KINJ_FLAG_DRY_RUN) {
        req->result = KINJ_OK;
        goto out_mm;
    }

    // 3. rw page for the mutable context, r-x page for the stub
    page_rw = kinj_map(mm, KINJ_PAGE_SZ, PROT_READ | PROT_WRITE);
    if (!page_rw) {
        ret = -ENOMEM;
        req->result = KINJ_E_MAP;
        goto out_mm;
    }
    page_rx = kinj_map(mm, KINJ_PAGE_SZ, PROT_READ | PROT_EXEC);
    if (!page_rx) {
        ret = -ENOMEM;
        req->result = KINJ_E_MAP;
        goto out_unmap;
    }

    ctx_va  = page_rw + KINJ_CTX_OFF;
    path_va = page_rw + KINJ_PATH_OFF;
    stub_va = page_rx;
    req->stub_va = stub_va;

    // 4. build ctx
    memset(&ctx, 0, sizeof(ctx));
    ctx.path_ptr  = path_va;
    ctx.flags     = RTLD_NOW | RTLD_GLOBAL;
    ctx.dlopen_va = dlopen_va;
    ctx.handle    = 0;
    ctx.orig_fn   = orig_got;
    ctx.entered   = 0;
    ctx.busy      = 0;

    // 5. write everything, then verify
    {
        __u8 stub[STUB_LEN];
        __u64 lit = ctx_va;
        __u64 check = 0;

        memcpy(stub, kinj_stub, STUB_LEN);
        memcpy(stub + STUB_LITERAL_OFF, &lit, sizeof(lit));

        if (kinj_write(task, ctx_va, &ctx, sizeof(ctx)) ||
            kinj_write(task, path_va, req->so_path, path_len) ||
            kinj_write(task, stub_va, stub, STUB_LEN)) {
            ret = -EFAULT;
            req->result = KINJ_E_WRITE;
            goto out_unmap;
        }

        if (kinj_read(task, ctx_va, &ctx, sizeof(ctx)) ||
            kinj_read(task, stub_va + STUB_LITERAL_OFF, &check, sizeof(check)) ||
            ctx.dlopen_va != dlopen_va || ctx.path_ptr != path_va ||
            check != ctx_va) {
            ret = -EFAULT;
            req->result = KINJ_E_VERIFY;
            goto out_unmap;
        }
    }

    // 6. arm the GOT slot
    {
        __u64 target = stub_va;

        if (kinj_write(task, got_va, &target, sizeof(target))) {
            ret = -EFAULT;
            req->result = KINJ_E_WRITE;
            goto out_unmap;
        }
        armed = true;
    }

    // 7. wait for the first entry, then put the GOT back immediately.
    //    The stub keeps a busy flag, so any thread that was already
    //    inside the PLT just tail-calls the original.
    budget = req->timeout_ms;
    for (i = 0; i < budget; i++) {
        __u32 entered = 0;

        usleep_range(500, 800);
        if (kinj_read(task, ctx_va + offsetof(struct kinj_ctx, entered),
                      &entered, sizeof(entered)))
            break;
        if (entered) {
            hit = true;
            break;
        }
    }

    if (armed) {
        __u64 back = orig_got;

        kinj_write(task, got_va, &back, sizeof(back));
        armed = false;
        pr_info(KINJ_TAG "GOT restored, hook window closed\n");
    }

    if (!hit) {
        pr_warn(KINJ_TAG "%s never called within %ums\n",
                req->hook_symbol, req->timeout_ms);
        req->result = KINJ_E_TIMEOUT;
        ret = -ETIMEDOUT;
        goto out_unmap;
    }

    // 8. wait for dlopen to come back
    budget = req->timeout_ms;
    for (i = 0; i < budget; i++) {
        __u64 h = 0;

        usleep_range(500, 800);
        if (kinj_read(task, ctx_va + offsetof(struct kinj_ctx, handle),
                      &h, sizeof(h)))
            break;
        if (h) {
            req->handle = h;
            req->result = KINJ_OK;
            pr_info(KINJ_TAG "dlopen(\"%s\") -> 0x%llx\n",
                    req->so_path, (unsigned long long)h);
            break;
        }
    }

    if (!req->handle) {
        req->result = KINJ_E_DLOPEN;
        ret = -EIO;
    }

    if (!ret && (req->flags & KINJ_FLAG_RECLAIM)) {
        // the stub has returned by the time the handle is published,
        // so the r-x page is safe to drop after a short grace period
        msleep(500);
        kinj_unmap(mm, page_rx, KINJ_PAGE_SZ);
        page_rx = 0;
        kinj_unmap(mm, page_rw, KINJ_PAGE_SZ);
        page_rw = 0;
    }

    goto out_mm;

out_unmap:
    if (armed) {
        __u64 back = orig_got;

        kinj_write(task, got_va, &back, sizeof(back));
    }
    if (page_rx)
        kinj_unmap(mm, page_rx, KINJ_PAGE_SZ);
    if (page_rw)
        kinj_unmap(mm, page_rw, KINJ_PAGE_SZ);
out_mm:
    mmput(mm);
out_task:
    put_task_struct(task);
    return ret;
}

// ------------------------------------------------------------- kthread plumb

struct kinj_work {
    struct completion done;
    struct kinject_req req;
    int ret;
};

static int kinj_worker(void *arg)
{
    struct kinj_work *w = arg;

    w->ret = kinj_do_inject(&w->req);
    complete(&w->done);
    return 0;
}

static long kinj_ioctl(struct file *f, unsigned int cmd, unsigned long arg)
{
    struct kinj_work *w;
    struct task_struct *k;
    long ret;

    if (!capable(CAP_SYS_ADMIN))
        return -EPERM;

    switch (cmd) {
    case KINJ_IOC_HIDE_MOD:
        kinj_hide_module();
        return 0;
    case KINJ_IOC_SHOW_MOD:
        kinj_show_module();
        return 0;
    case KINJ_IOC_INJECT:
        break;
    default:
        return -ENOTTY;
    }

    w = kzalloc(sizeof(*w), GFP_KERNEL);
    if (!w)
        return -ENOMEM;

    if (copy_from_user(&w->req, (void __user *)arg, sizeof(w->req))) {
        kfree(w);
        return -EFAULT;
    }
    init_completion(&w->done);

    k = kthread_run(kinj_worker, w, "kinj/%d", task_pid_nr(current));
    if (IS_ERR(k)) {
        ret = PTR_ERR(k);
        kfree(w);
        return ret;
    }

    wait_for_completion(&w->done);
    ret = w->ret;

    if ((w->req.flags & KINJ_FLAG_HIDE_MOD) && !ret)
        kinj_hide_module();

    if (copy_to_user((void __user *)arg, &w->req, sizeof(w->req)))
        ret = -EFAULT;
    kfree(w);
    return ret;
}

static const struct file_operations kinj_fops = {
    .owner          = THIS_MODULE,
    .unlocked_ioctl = kinj_ioctl,
    // no .compat_ioctl: the request struct is layout-sensitive and the
    // tool ships arm64 only. A 32-bit caller gets ENOTTY, not garbage.
};

static struct miscdevice kinj_misc = {
    .minor = MISC_DYNAMIC_MINOR,
    .name  = "kinjector",
    .fops  = &kinj_fops,
    .mode  = 0600,
};

static int __init kinj_init(void)
{
    int ret = misc_register(&kinj_misc);

    if (ret)
        return ret;
    pr_info(KINJ_TAG "loaded, /dev/kinjector ready\n");
    return 0;
}

static void __exit kinj_exit(void)
{
    misc_deregister(&kinj_misc);
    kinj_show_module();
    pr_info(KINJ_TAG "unloaded; injected pages stay mapped in targets\n");
}

module_init(kinj_init);
module_exit(kinj_exit);

MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("arm64 GOT-slot dlopen injector");
MODULE_AUTHOR("kanha");
MODULE_VERSION("2.0");
