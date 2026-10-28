/* kinject_ioctl.h — ABI shared by the kernel module and the userspace tool.
 *
 * Keep this file byte-identical on both sides. Never reorder fields.
 */
#pragma once

#ifdef __KERNEL__
#include <linux/types.h>
#include <linux/ioctl.h>
#else
#include <stdint.h>
#include <sys/ioctl.h>
#if defined(__has_include)
#  if __has_include(<linux/types.h>)
#    include <linux/types.h>
#    define KINJ_HAVE_LINUX_TYPES 1
#  endif
#endif
#ifndef KINJ_HAVE_LINUX_TYPES
typedef uint8_t  __u8;
typedef uint32_t __u32;
typedef int32_t  __s32;
typedef uint64_t __u64;
#endif
#endif

#define PKG_NAME_MAX 256
#define SO_PATH_MAX  512
#define LIB_NAME_MAX 64
#define SYM_NAME_MAX 64

/* flags */
#define KINJ_FLAG_HIDE_MOD   (1u << 0)   /* delist from /proc/modules        */
#define KINJ_FLAG_RECLAIM    (1u << 1)   /* unmap the stub page afterwards   */
#define KINJ_FLAG_DRY_RUN    (1u << 2)   /* resolve + report, do not patch   */

/* results reported back in req.result */
#define KINJ_OK                 0
#define KINJ_E_NO_TASK         -1
#define KINJ_E_NO_MM           -2
#define KINJ_E_32BIT           -3
#define KINJ_E_NO_LIB          -4
#define KINJ_E_NO_DLOPEN       -5
#define KINJ_E_NO_SYMBOL       -6
#define KINJ_E_MAP             -7
#define KINJ_E_WRITE           -8
#define KINJ_E_VERIFY          -9
#define KINJ_E_TIMEOUT        -10
#define KINJ_E_DLOPEN         -11

struct kinject_req {
    char     pkg_name[PKG_NAME_MAX];     /* "com.dts.freefireth"            */
    char     so_path[SO_PATH_MAX];       /* path, must be app-readable      */
    char     target_lib[LIB_NAME_MAX];   /* default "libil2cpp.so"          */
    char     hook_symbol[SYM_NAME_MAX];  /* default "clock_gettime"         */
    __u32    flags;
    __u32    timeout_ms;                 /* wait for the GOT hit            */
    __s32    result;                     /* KINJ_* on return                */
    __u32    _pad;

    /* filled in by the module, for logging */
    __u64    task_pid;
    __u64    lib_base;
    __u64    got_va;
    __u64    stub_va;
    __u64    handle;
};

#define KINJ_IOC_MAGIC    'K'
#define KINJ_IOC_INJECT   _IOWR(KINJ_IOC_MAGIC, 1, struct kinject_req)
#define KINJ_IOC_HIDE_MOD _IO  (KINJ_IOC_MAGIC, 2)
#define KINJ_IOC_SHOW_MOD _IO  (KINJ_IOC_MAGIC, 3)
