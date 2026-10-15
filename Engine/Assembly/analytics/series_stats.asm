; ============================================================
; analytics/series_stats.asm — one-pass statistics and regression sums over double-precision series (the history the
; Analytics page works on: CPU load and network rates sampled once a second, up to a day or more of them).
;
;   si_series_stats_f64_{sse2,avx2}(const double* a, size_t n, SiSeriesStats* out)
;       struct SiSeriesStats { double sum; double min; double max; }   (24 bytes)
;       out->sum = sum of a[0..n), out->min / out->max = smallest / largest element.
;       n == 0 leaves *out untouched (the C++ layer never calls with n == 0).
;
;   si_series_regress_f64_{sse2,avx2}(const double* x, const double* y, size_t n, SiSeriesRegress* out)
;       struct SiSeriesRegress { double sx; double sy; double sxy; double sxx; }   (32 bytes)
;       out->sx = sum x, out->sy = sum y, out->sxy = sum x*y, out->sxx = sum x*x.   n == 0 leaves *out untouched.
;       The caller passes values already shifted close to zero (the C++ layer subtracts the first point), which keeps the
;       least-squares slope accurate; no FMA is used, so every product and sum is rounded exactly like plain double maths.
;
; Inputs must not contain NaN (min/max would then depend on lane order); the caller filters them out first. Infinities
; behave as in ordinary double arithmetic. Sums are reassociated (SIMD lanes), so they can differ from a left-to-right
; sum in the last bits.
;
; Conventions (same as the other kernels here): only volatile registers (RAX, R10, R11, XMM0-5 / YMM0-5), no stack use,
; unaligned loads, scalar tail below one vector width. All arguments are integers/pointers, so Windows x64 and System V
; both find them in the registers abi.inc names. The AVX2 kernels are only called after the C++ dispatcher has confirmed
; CPUID AVX2 and OS YMM state, and end with VZEROUPPER.
; ============================================================

default rel
%include "abi.inc"

section .text
    global si_series_stats_f64_sse2
    global si_series_stats_f64_avx2
    global si_series_regress_f64_sse2
    global si_series_regress_f64_avx2

; ---------------------------------------------------------------- stats, SSE2
si_series_stats_f64_sse2:           ; a=ARG1 n=ARG2 out=ARG3
    test   ARG2, ARG2
    jz     .ret
    cmp    ARG2, 2
    jb     .one
    movupd xmm1, [ARG1]             ; first two elements seed min and max
    movapd xmm2, xmm1
    xorpd  xmm0, xmm0               ; running sum (2 lanes)
    mov    r11, ARG2
    and    r11, -2
    xor    r10d, r10d
.v:
    cmp    r10, r11
    jae    .h
    movupd xmm3, [ARG1 + r10*8]
    addpd  xmm0, xmm3
    minpd  xmm1, xmm3
    maxpd  xmm2, xmm3
    add    r10, 2
    jmp    .v
.h:                                 ; fold the two lanes
    movapd xmm3, xmm0
    unpckhpd xmm3, xmm3
    addsd  xmm0, xmm3
    movapd xmm3, xmm1
    unpckhpd xmm3, xmm3
    minsd  xmm1, xmm3
    movapd xmm3, xmm2
    unpckhpd xmm3, xmm3
    maxsd  xmm2, xmm3
.t:                                 ; scalar tail
    cmp    r10, ARG2
    jae    .store
    movsd  xmm3, [ARG1 + r10*8]
    addsd  xmm0, xmm3
    minsd  xmm1, xmm3
    maxsd  xmm2, xmm3
    inc    r10
    jmp    .t
.store:
    movsd  [ARG3], xmm0
    movsd  [ARG3 + 8], xmm1
    movsd  [ARG3 + 16], xmm2
.ret:
    ret
.one:                               ; n == 1
    movsd  xmm0, [ARG1]
    movapd xmm1, xmm0
    movapd xmm2, xmm0
    jmp    .store

; ---------------------------------------------------------------- stats, AVX2
si_series_stats_f64_avx2:
    test   ARG2, ARG2
    jz     .ret
    cmp    ARG2, 4
    jb     .small
    vmovupd ymm1, [ARG1]            ; first four elements seed min and max
    vmovapd ymm2, ymm1
    vxorpd ymm0, ymm0, ymm0         ; running sum (4 lanes)
    mov    r11, ARG2
    and    r11, -4
    xor    r10d, r10d
.v:
    cmp    r10, r11
    jae    .h
    vmovupd ymm3, [ARG1 + r10*8]
    vaddpd ymm0, ymm0, ymm3
    vminpd ymm1, ymm1, ymm3
    vmaxpd ymm2, ymm2, ymm3
    add    r10, 4
    jmp    .v
.h:                                 ; fold the four lanes: (l0+l2) + (l1+l3)
    vextractf128 xmm3, ymm0, 1
    vaddpd xmm0, xmm0, xmm3
    vunpckhpd xmm3, xmm0, xmm0
    vaddsd xmm0, xmm0, xmm3
    vextractf128 xmm3, ymm1, 1
    vminpd xmm1, xmm1, xmm3
    vunpckhpd xmm3, xmm1, xmm1
    vminsd xmm1, xmm1, xmm3
    vextractf128 xmm3, ymm2, 1
    vmaxpd xmm2, xmm2, xmm3
    vunpckhpd xmm3, xmm2, xmm2
    vmaxsd xmm2, xmm2, xmm3
.t:
    cmp    r10, ARG2
    jae    .store
    vmovsd xmm3, [ARG1 + r10*8]
    vaddsd xmm0, xmm0, xmm3
    vminsd xmm1, xmm1, xmm3
    vmaxsd xmm2, xmm2, xmm3
    inc    r10
    jmp    .t
.store:
    vmovsd [ARG3], xmm0
    vmovsd [ARG3 + 8], xmm1
    vmovsd [ARG3 + 16], xmm2
    vzeroupper
.ret:
    ret
.small:                             ; 1..3 elements: scalar, seeded with the first
    vmovsd xmm0, [ARG1]
    vmovapd xmm1, xmm0
    vmovapd xmm2, xmm0
    mov    r10d, 1
    jmp    .t

; ---------------------------------------------------------------- regression sums, SSE2
si_series_regress_f64_sse2:         ; x=ARG1 y=ARG2 n=ARG3 out=ARG4
    test   ARG3, ARG3
    jz     .ret
    xorpd  xmm0, xmm0               ; sum x
    xorpd  xmm1, xmm1               ; sum y
    xorpd  xmm2, xmm2               ; sum x*y
    xorpd  xmm3, xmm3               ; sum x*x
    mov    r11, ARG3
    and    r11, -2
    xor    r10d, r10d
.v:
    cmp    r10, r11
    jae    .h
    movupd xmm4, [ARG1 + r10*8]     ; x
    movupd xmm5, [ARG2 + r10*8]     ; y
    addpd  xmm0, xmm4
    addpd  xmm1, xmm5
    mulpd  xmm5, xmm4               ; y*x  (y is already summed, so the register is free)
    addpd  xmm2, xmm5
    mulpd  xmm4, xmm4               ; x*x
    addpd  xmm3, xmm4
    add    r10, 2
    jmp    .v
.h:
    movapd xmm4, xmm0
    unpckhpd xmm4, xmm4
    addsd  xmm0, xmm4
    movapd xmm4, xmm1
    unpckhpd xmm4, xmm4
    addsd  xmm1, xmm4
    movapd xmm4, xmm2
    unpckhpd xmm4, xmm4
    addsd  xmm2, xmm4
    movapd xmm4, xmm3
    unpckhpd xmm4, xmm4
    addsd  xmm3, xmm4
.t:
    cmp    r10, ARG3
    jae    .store
    movsd  xmm4, [ARG1 + r10*8]
    movsd  xmm5, [ARG2 + r10*8]
    addsd  xmm0, xmm4
    addsd  xmm1, xmm5
    mulsd  xmm5, xmm4
    addsd  xmm2, xmm5
    mulsd  xmm4, xmm4
    addsd  xmm3, xmm4
    inc    r10
    jmp    .t
.store:
    movsd  [ARG4], xmm0
    movsd  [ARG4 + 8], xmm1
    movsd  [ARG4 + 16], xmm2
    movsd  [ARG4 + 24], xmm3
.ret:
    ret

; ---------------------------------------------------------------- regression sums, AVX2
si_series_regress_f64_avx2:
    test   ARG3, ARG3
    jz     .ret
    vxorpd ymm0, ymm0, ymm0
    vxorpd ymm1, ymm1, ymm1
    vxorpd ymm2, ymm2, ymm2
    vxorpd ymm3, ymm3, ymm3
    mov    r11, ARG3
    and    r11, -4
    xor    r10d, r10d
.v:
    cmp    r10, r11
    jae    .h
    vmovupd ymm4, [ARG1 + r10*8]
    vmovupd ymm5, [ARG2 + r10*8]
    vaddpd ymm0, ymm0, ymm4
    vaddpd ymm1, ymm1, ymm5
    vmulpd ymm5, ymm5, ymm4
    vaddpd ymm2, ymm2, ymm5
    vmulpd ymm4, ymm4, ymm4
    vaddpd ymm3, ymm3, ymm4
    add    r10, 4
    jmp    .v
.h:
    vextractf128 xmm4, ymm0, 1
    vaddpd xmm0, xmm0, xmm4
    vunpckhpd xmm4, xmm0, xmm0
    vaddsd xmm0, xmm0, xmm4
    vextractf128 xmm4, ymm1, 1
    vaddpd xmm1, xmm1, xmm4
    vunpckhpd xmm4, xmm1, xmm1
    vaddsd xmm1, xmm1, xmm4
    vextractf128 xmm4, ymm2, 1
    vaddpd xmm2, xmm2, xmm4
    vunpckhpd xmm4, xmm2, xmm2
    vaddsd xmm2, xmm2, xmm4
    vextractf128 xmm4, ymm3, 1
    vaddpd xmm3, xmm3, xmm4
    vunpckhpd xmm4, xmm3, xmm3
    vaddsd xmm3, xmm3, xmm4
.t:
    cmp    r10, ARG3
    jae    .store
    vmovsd xmm4, [ARG1 + r10*8]
    vmovsd xmm5, [ARG2 + r10*8]
    vaddsd xmm0, xmm0, xmm4
    vaddsd xmm1, xmm1, xmm5
    vmulsd xmm5, xmm5, xmm4
    vaddsd xmm2, xmm2, xmm5
    vmulsd xmm4, xmm4, xmm4
    vaddsd xmm3, xmm3, xmm4
    inc    r10
    jmp    .t
.store:
    vmovsd [ARG4], xmm0
    vmovsd [ARG4 + 8], xmm1
    vmovsd [ARG4 + 16], xmm2
    vmovsd [ARG4 + 24], xmm3
    vzeroupper
.ret:
    ret

%ifidn __OUTPUT_FORMAT__, elf64
section .note.GNU-stack noalloc noexec nowrite progbits
%endif
