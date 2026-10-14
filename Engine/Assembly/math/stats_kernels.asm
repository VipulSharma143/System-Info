; ============================================================
; math/stats_kernels.asm — one-pass statistics over a float array, used by the overlay engine for per-core load
; (average / busiest / how many are active) and for the busiest GPU engine.
;
;   si_stats_f32_{sse2,avx2}(const float* a, size_t n, SiStats* s)
;
;   struct SiStats { float sum; float max; float threshold; int32 count; }   (16 bytes)
;   in : s->threshold
;   out: s->sum   = sum of a[0..n)
;        s->max   = largest element (n == 0 -> 0)
;        s->count = number of elements with a[i] >= threshold
;
; Inputs must be finite (the caller replaces NaN/inf first). Only volatile registers are used (RAX,R10,R11,
; XMM0-5 / YMM0-5), there is no stack use, loads are unaligned, and the tail below one vector width is scalar.
; The AVX2 kernel is only called after the C++ dispatcher has confirmed CPUID AVX2 and OS YMM state.
; ============================================================

default rel
%include "abi.inc"

section .rodata
align 16
neg_big: dd 0xFF7FFFFF, 0xFF7FFFFF, 0xFF7FFFFF, 0xFF7FFFFF     ; -FLT_MAX in every lane

section .text
    global si_stats_f32_sse2
    global si_stats_f32_avx2

si_stats_f32_sse2:              ; a=ARG1 n=ARG2 s=ARG3
    xorps  xmm0, xmm0           ; running sum (4 lanes)
    movaps xmm1, [neg_big]      ; running max (4 lanes)
    movss  xmm2, [ARG3 + 8]     ; threshold
    shufps xmm2, xmm2, 0
    pxor   xmm3, xmm3           ; running count (4 x int32)
    xor    r10d, r10d
    mov    r11, ARG2
    and    r11, -4
.v:
    cmp    r10, r11
    jae    .h
    movups xmm4, [ARG1 + r10*4]
    addps  xmm0, xmm4
    maxps  xmm1, xmm4
    movaps xmm5, xmm2
    cmpps  xmm5, xmm4, 2        ; threshold <= value  (false for NaN)
    psubd  xmm3, xmm5           ; mask is -1 where true
    add    r10, 4
    jmp    .v
.h:                             ; horizontal reduction of the four lanes
    movaps xmm4, xmm0
    movhlps xmm4, xmm0
    addps  xmm0, xmm4
    movaps xmm4, xmm0
    shufps xmm4, xmm4, 1
    addss  xmm0, xmm4
    movaps xmm4, xmm1
    movhlps xmm4, xmm1
    maxps  xmm1, xmm4
    movaps xmm4, xmm1
    shufps xmm4, xmm4, 1
    maxss  xmm1, xmm4
    movdqa xmm4, xmm3
    psrldq xmm4, 8
    paddd  xmm3, xmm4
    movdqa xmm4, xmm3
    psrldq xmm4, 4
    paddd  xmm3, xmm4
    movd   eax, xmm3
.t:                             ; scalar tail
    cmp    r10, ARG2
    jae    .d
    movss  xmm4, [ARG1 + r10*4]
    addss  xmm0, xmm4
    maxss  xmm1, xmm4
    comiss xmm4, xmm2
    jb     .skip
    inc    eax
.skip:
    inc    r10
    jmp    .t
.d:
    test   ARG2, ARG2           ; n == 0: max would still be -FLT_MAX
    jnz    .store
    xorps  xmm1, xmm1
.store:
    movss  [ARG3], xmm0
    movss  [ARG3 + 4], xmm1
    mov    [ARG3 + 12], eax
    ret

si_stats_f32_avx2:
    vxorps xmm0, xmm0, xmm0
    vmovaps xmm1, [neg_big]
    vinsertf128 ymm1, ymm1, xmm1, 1
    vbroadcastss ymm2, [ARG3 + 8]
    vpxor  ymm3, ymm3, ymm3
    xor    r10d, r10d
    mov    r11, ARG2
    and    r11, -8
.v:
    cmp    r10, r11
    jae    .h
    vmovups ymm4, [ARG1 + r10*4]
    vaddps ymm0, ymm0, ymm4
    vmaxps ymm1, ymm1, ymm4
    vcmpps ymm5, ymm2, ymm4, 0x12   ; threshold <= value, ordered (false for NaN)
    vpsubd ymm3, ymm3, ymm5
    add    r10, 8
    jmp    .v
.h:
    vextractf128 xmm4, ymm0, 1
    vaddps xmm0, xmm0, xmm4
    vmovhlps xmm4, xmm4, xmm0
    vaddps xmm0, xmm0, xmm4
    vshufps xmm4, xmm0, xmm0, 1
    vaddss xmm0, xmm0, xmm4
    vextractf128 xmm4, ymm1, 1
    vmaxps xmm1, xmm1, xmm4
    vmovhlps xmm4, xmm4, xmm1
    vmaxps xmm1, xmm1, xmm4
    vshufps xmm4, xmm1, xmm1, 1
    vmaxss xmm1, xmm1, xmm4
    vextracti128 xmm4, ymm3, 1
    vpaddd xmm3, xmm3, xmm4
    vpsrldq xmm4, xmm3, 8
    vpaddd xmm3, xmm3, xmm4
    vpsrldq xmm4, xmm3, 4
    vpaddd xmm3, xmm3, xmm4
    vmovd  eax, xmm3
.t:
    cmp    r10, ARG2
    jae    .d
    vmovss xmm4, [ARG1 + r10*4]
    vaddss xmm0, xmm0, xmm4
    vmaxss xmm1, xmm1, xmm4
    vcomiss xmm4, xmm2
    jb     .skip
    inc    eax
.skip:
    inc    r10
    jmp    .t
.d:
    test   ARG2, ARG2
    jnz    .store
    vxorps xmm1, xmm1, xmm1
.store:
    vmovss [ARG3], xmm0
    vmovss [ARG3 + 4], xmm1
    mov    [ARG3 + 12], eax
    vzeroupper
    ret

%ifidn __OUTPUT_FORMAT__, elf64
section .note.GNU-stack noalloc noexec nowrite progbits
%endif
