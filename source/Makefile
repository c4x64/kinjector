# ================================================================
#  Makefile — kinjector.ko  (out of tree, arm64)
#
#  KDIR must be the *device's* kernel tree, matching the running
#  kernel version and the vendor's config. A generic mainline tree
#  will build, but vermagic will not match and insmod will refuse.
#
#    export KDIR=$HOME/kernel/msm-5.15
#    export CROSS_COMPILE=$NDK/toolchains/llvm/prebuilt/*/bin/aarch64-linux-gnu-
#    make
#
#  If the vendor ships only a kernel image, get vermagic from:
#    strings vmlinux | grep -m1 'Linux version'
#  and build against a tree with the same CONFIG_LOCALVERSION.
# ================================================================

obj-m := kinjector.o

KDIR    ?= /lib/modules/$(shell uname -r)/build
ARCH    ?= arm64
CROSS_COMPILE ?= aarch64-linux-gnu-

ccflags-y += -Wall -Wno-unused-parameter

all:
	$(MAKE) -C $(KDIR) M=$(PWD) ARCH=$(ARCH) CROSS_COMPILE=$(CROSS_COMPILE) modules

clean:
	$(MAKE) -C $(KDIR) M=$(PWD) ARCH=$(ARCH) CROSS_COMPILE=$(CROSS_COMPILE) clean
	rm -f *.o *.ko *.mod *.mod.c modules.order Module.symvers

strip:
	$(CROSS_COMPILE)strip --strip-debug kinjector.ko

.PHONY: all clean strip
