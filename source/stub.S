// ============================================================
//  stub.S — arm64 GOT trampoline for kinjector
//
//  Lives in an anonymous r-x mapping inside the target process.
//  It never writes to executable memory: the mutable part of the
//  context sits in a separate rw- page, because a store into an
//  r-x VMA would fault in the target.
//
//  Contract
//    - Entered exactly like the hooked symbol (same args, same x30).
//    - Saves every argument register, integer and vector.
//    - Uses ctx->busy so a second thread that was already inside the
//      PLT cannot run dlopen twice. On the busy path it simply
//      tail-calls the original function.
//    - Sets ctx->entered before calling dlopen. That is the signal
//      the kernel waits for to put the GOT back, which keeps the
//      hooked window down to a few instructions.
//    - Stores the handle, restores registers, tail-calls the original.
//
//  ctx layout (see struct kinj_ctx in kinjector.c)
//    0x00  path_ptr          (rw page)
//    0x08  dlopen flags
//    0x10  dlopen address
//    0x18  handle out
//    0x20  original function pointer
//    0x28  entered  u32
//    0x2c  busy     u32
//
//  The trailing literal is patched at inject time with the ctx address.
// ============================================================

    .text
    .globl  ff_stub
    .type   ff_stub, %function
    .balign 4
ff_stub:
    ldr     x9, lit_ctx

    ldr     w12, [x9, #0x2c]        // busy?
    cbnz    w12, tail

    mov     w12, #1
    str     w12, [x9, #0x2c]        // busy = 1
    str     w12, [x9, #0x28]        // entered = 1  (kernel watches this)

    sub     sp, sp, #0xd0
    stp     x0, x1, [sp, #0x00]
    stp     x2, x3, [sp, #0x10]
    stp     x4, x5, [sp, #0x20]
    stp     x6, x7, [sp, #0x30]
    stp     x30, x9, [sp, #0x40]
    stp     q0, q1, [sp, #0x50]
    stp     q2, q3, [sp, #0x70]
    stp     q4, q5, [sp, #0x90]
    stp     q6, q7, [sp, #0xb0]

    ldr     x0, [x9, #0x00]
    ldr     x1, [x9, #0x08]
    ldr     x10, [x9, #0x10]
    blr     x10
    ldr     x9, [sp, #0x48]         // dlopen clobbered x9; reload ctx
    str     x0, [x9, #0x18]

    ldp     q6, q7, [sp, #0xb0]
    ldp     q4, q5, [sp, #0x90]
    ldp     q2, q3, [sp, #0x70]
    ldp     q0, q1, [sp, #0x50]
    ldp     x30, x9, [sp, #0x40]
    ldp     x6, x7, [sp, #0x30]
    ldp     x4, x5, [sp, #0x20]
    ldp     x2, x3, [sp, #0x10]
    ldp     x0, x1, [sp, #0x00]
    add     sp, sp, #0xd0

tail:
    ldr     x10, [x9, #0x20]
    br      x10

    .balign 8
lit_ctx:
    .quad   0
    .size   ff_stub, .-ff_stub
