// ================================================================
//  kinject_user.c — userspace caller for kinjector.ko
//
//  Build (NDK, static, arm64):
//    $NDK/toolchains/llvm/prebuilt/*/bin/aarch64-linux-android29-clang \
//        -O2 -static -o kinject kinject_user.c
//
//  Usage:
//    kinject <package> <so_path> [options]
//
//  Options:
//    --lib <name>      library holding the trigger GOT slot
//                      (default: libil2cpp.so)
//    --symbol <name>   imported symbol to bounce through
//                      (default: clock_gettime)
//    --timeout <ms>    how long to wait for the trigger (default 3000)
//    --hide            delist the module from /proc/modules on success
//    --dry             resolve everything, patch nothing
//    --show            relist the module and exit
//
//  The .so path must be readable by the *app* uid, not by root.
//  /data/local/tmp is usually 0771 and therefore NOT readable by apps.
//  Put the payload in the app's own data dir instead:
//
//    su -c 'cp /data/local/tmp/libffext.so \
//           /data/data/com.dts.freefireth/files/libffext.so'
//    su -c 'chown $(stat -c %u:%g /data/data/com.dts.freefireth/files) \
//           /data/data/com.dts.freefireth/files/libffext.so'
//    su -c 'chmod 600 /data/data/com.dts.freefireth/files/libffext.so'
// ================================================================

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <stdint.h>

#include "kinject_ioctl.h"

static const char *result_str(int r)
{
    switch (r) {
    case KINJ_OK:          return "ok";
    case KINJ_E_NO_TASK:   return "target process not found";
    case KINJ_E_NO_MM:     return "target has no mm";
    case KINJ_E_32BIT:     return "target is a 32-bit process";
    case KINJ_E_NO_LIB:    return "target library not mapped";
    case KINJ_E_NO_DLOPEN: return "dlopen not resolvable in target";
    case KINJ_E_NO_SYMBOL: return "trigger GOT slot not found";
    case KINJ_E_MAP:       return "could not map a page in target";
    case KINJ_E_WRITE:     return "write into target failed";
    case KINJ_E_VERIFY:    return "readback verification failed";
    case KINJ_E_TIMEOUT:   return "trigger never fired, GOT restored";
    case KINJ_E_DLOPEN:    return "dlopen returned no handle";
    default:               return "unknown";
    }
}

int main(int argc, char **argv)
{
    struct kinject_req req;
    int fd, ret;

    if (argc < 2) {
        fprintf(stderr,
            "usage: %s <package> <so_path> [--lib n] [--symbol s]\n"
            "       [--timeout ms] [--hide] [--dry]\n"
            "       %s --show\n", argv[0], argv[0]);
        return 2;
    }

    memset(&req, 0, sizeof(req));
    strncpy(req.pkg_name, argv[1], PKG_NAME_MAX - 1);
    strncpy(req.so_path,  argc > 2 ? argv[2] : "", SO_PATH_MAX - 1);
    req.timeout_ms = 3000;

    for (int i = 3; i < argc; i++) {
        if (!strcmp(argv[i], "--lib") && i + 1 < argc)
            strncpy(req.target_lib, argv[++i], LIB_NAME_MAX - 1);
        else if (!strcmp(argv[i], "--symbol") && i + 1 < argc)
            strncpy(req.hook_symbol, argv[++i], SYM_NAME_MAX - 1);
        else if (!strcmp(argv[i], "--timeout") && i + 1 < argc)
            req.timeout_ms = (uint32_t)strtoul(argv[++i], NULL, 10);
        else if (!strcmp(argv[i], "--hide"))
            req.flags |= KINJ_FLAG_HIDE_MOD;
        else if (!strcmp(argv[i], "--dry"))
            req.flags |= KINJ_FLAG_DRY_RUN;
        else if (!strcmp(argv[i], "--reclaim"))
            req.flags |= KINJ_FLAG_RECLAIM;
    }

    fd = open("/dev/kinjector", O_RDWR);
    if (fd < 0) {
        perror("open /dev/kinjector");
        fprintf(stderr, "is the module loaded? (insmod kinjector.ko)\n");
        return 1;
    }

    if (argc == 2 && !strcmp(argv[1], "--show")) {
        if (ioctl(fd, KINJ_IOC_SHOW_MOD) < 0) {
            perror("ioctl KINJ_IOC_SHOW_MOD");
            close(fd);
            return 1;
        }
        printf("module relisted\n");
        close(fd);
        return 0;
    }

    ret = ioctl(fd, KINJ_IOC_INJECT, &req);
    if (ret < 0) {
        fprintf(stderr, "inject failed: %s (%d) %s\n",
                result_str(req.result), req.result,
                errno ? strerror(errno) : "");
        close(fd);
        return 1;
    }

    printf("pid      %llu\n", (unsigned long long)req.task_pid);
    printf("lib      %s @ 0x%llx\n",
           req.target_lib[0] ? req.target_lib : "libil2cpp.so",
           (unsigned long long)req.lib_base);
    printf("got      0x%llx  (%s)\n",
           (unsigned long long)req.got_va,
           req.hook_symbol[0] ? req.hook_symbol : "clock_gettime");
    printf("stub     0x%llx\n", (unsigned long long)req.stub_va);
    printf("handle   0x%llx\n", (unsigned long long)req.handle);
    printf("result   %s\n", result_str(req.result));

    close(fd);
    return req.result == KINJ_OK ? 0 : 1;
}
