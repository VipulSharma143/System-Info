; ============================================================
; analytics/series_scan.asm — threshold scans over a double-precision series: how many values are at or above a
; threshold, where the next one is, and where the next one that is not. A day of history is mostly quiet, so these let
; the run/spike detection in the Analytics page skip whole stretches four (AVX2) or two (SSE2) values at a time.
;
;   size_t si_series_count_ge_f64_avx2(const double* a, size_t n, const double* threshold)
;       number of i < n with a[i] >= *threshold. AVX2 only: the SSE2 version measured slower than the portable C++ loop
;       at every working-set size (kernel_bench, s_count), so the SSE2 tier uses the portable code for this one.
;   size_t si_series_find_ge_f64_{sse2,avx2}(const double* a, size_t n, size_t start, const double* threshold)
;       smallest i in [start, n) with a[i] >= *threshold, or n when there is none (also when start >= n)
;   size_t si_series_find_nge_f64_{sse2,avx2}(const double* a, size_t n, size_t start, const double* threshold)
;       smallest i in [start, n) with NOT (a[i] >= *threshold), or n when there is none
;
; "a[i] >= threshold" is the ordered comparison, so a NaN is never at or above the threshold: a NaN marks a missing sample
; and counts as "not above" (it ends a run), exactly like a missing value in the managed code. The threshold is passed
; by pointer so the same registers work on Windows x64 (where a fourth double argument would travel in XMM3) and on
; System V. Results are returned in RAX.
;
; Same conventions as the other kernels: volatile registers only (RAX, R10, R11, XMM0-5 / YMM0-5), no stack use,
; unaligned loads, scalar tail, VZEROUPPER at the end of the AVX2 versions.
; ============================================================

default rel
%include "abi.inc"

section .text
    global si_series_count_ge_f64_avx2
    global si_series_find_ge_f64_sse2
    global si_series_find_ge_f64_avx2
    global si_series_find_nge_f64_sse2
    global si_series_find_nge_f64_avx2

; ---------------------------------------------------------------- count, AVX2
si_series_count_ge_f64_avx2:
    vbroadcastsd ymm2, [ARG3]
    vpxor  ymm3, ymm3, ymm3         ; four int64 counters
    mov    r11, ARG2
    and    r11, -4
    xor    r10d, r10d
.v:
    cmp    r10, r11
    jae    .h
    vmovupd ymm4, [ARG1 + r10*8]
    vcmppd ymm5, ymm2, ymm4, 0x12   ; threshold <= value, ordered quiet (false for NaN)
    vpsubq ymm3, ymm3, ymm5
    add    r10, 4
    jmp    .v
.h:
    vextracti128 xmm4, ymm3, 1
    vpaddq xmm3, xmm3, xmm4
    vpsrldq xmm4, xmm3, 8
    vpaddq xmm3, xmm3, xmm4
    vmovq  rax, xmm3
.t:
    cmp    r10, ARG2
    jae    .d
    vmovsd xmm4, [ARG1 + r10*8]
    vcomisd xmm4, xmm2
    jb     .skip
    inc    rax
.skip:
    inc    r10
    jmp    .t
.d:
    vzeroupper
    ret

; ---------------------------------------------------------------- find first match, SSE2
; %1 = symbol, %2 = vector compare producing a mask of the lanes that match (cmplepd = value >= threshold,
; cmpnlepd = NOT value >= threshold), %3 = scalar jump taken on a match after COMISD value, threshold
; (jae: value >= threshold; jb: below it, or NaN)
%macro FIND_SSE2 3
%1:                                 ; a=ARG1 n=ARG2 start=ARG3 threshold*=ARG4
    movsd  xmm2, [ARG4]
    unpcklpd xmm2, xmm2
    mov    r10, ARG3
.v:
    lea    rax, [r10 + 2]
    cmp    rax, ARG2
    ja     .t                       ; fewer than two values left (also covers start >= n)
    movupd xmm4, [ARG1 + r10*8]
    movapd xmm5, xmm2
    %2     xmm5, xmm4
    movmskpd eax, xmm5
    test   eax, eax
    jnz    .hit
    add    r10, 2
    jmp    .v
.hit:
    bsf    eax, eax
    add    rax, r10
    ret
.t:
    cmp    r10, ARG2
    jae    .none
    movsd  xmm4, [ARG1 + r10*8]
    comisd xmm4, xmm2
    %3     .found
    inc    r10
    jmp    .t
.found:
    mov    rax, r10
    ret
.none:
    mov    rax, ARG2
    ret
%endmacro

; ---------------------------------------------------------------- find first match, AVX2
%macro FIND_AVX2 3                  ; %1 = symbol, %2 = vcmppd predicate (0x12 = >=, 0x16 = NOT >=), %3 = scalar jump on a match
%1:
    vbroadcastsd ymm2, [ARG4]
    mov    r10, ARG3
.v:
    lea    rax, [r10 + 4]
    cmp    rax, ARG2
    ja     .t
    vmovupd ymm4, [ARG1 + r10*8]
    vcmppd ymm5, ymm2, ymm4, %2
    vmovmskpd eax, ymm5
    test   eax, eax
    jnz    .hit
    add    r10, 4
    jmp    .v
.hit:
    bsf    eax, eax
    add    rax, r10
    vzeroupper
    ret
.t:
    cmp    r10, ARG2
    jae    .none
    vmovsd xmm4, [ARG1 + r10*8]
    vcomisd xmm4, xmm2
    %3     .found
    inc    r10
    jmp    .t
.found:
    mov    rax, r10
    vzeroupper
    ret
.none:
    mov    rax, ARG2
    vzeroupper
    ret
%endmacro

FIND_SSE2 si_series_find_ge_f64_sse2,  cmplepd,  jae
FIND_SSE2 si_series_find_nge_f64_sse2, cmpnlepd, jb
FIND_AVX2 si_series_find_ge_f64_avx2,  0x12,     jae
FIND_AVX2 si_series_find_nge_f64_avx2, 0x16,     jb

%ifidn __OUTPUT_FORMAT__, elf64
section .note.GNU-stack noalloc noexec nowrite progbits
%endif
