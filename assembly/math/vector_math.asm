; ============================================================
; math/vector_math.asm — numeric kernels for the native benchmark and CPU self-test.
; Each kernel exists in an SSE2 form (x86-64 baseline, always safe) and an AVX2 form (only
; called after the C++ dispatcher has confirmed CPUID AVX2 *and* OS YMM state via XGETBV).
;
;   si_vec_add_f32_{sse2,avx2}(const float* a, const float* b, float* out, size_t n)
;   si_dot_f32_{sse2,avx2}    (const float* a, const float* b, size_t n)      -> float (xmm0)
;   si_sum_i32_{sse2,avx2}    (const int32_t* a, size_t n)                    -> int64 (rax)
;   si_minmax_i32_{sse2,avx2} (const int32_t* a, size_t n, int32_t* min, int32_t* max)  (n==0 is a no-op)
;
; Only volatile registers (RAX,R10,R11, XMM0-5/YMM0-5) are touched, there is no stack use, all
; loads/stores are unaligned, and n==0 / n<vector width fall through to the scalar tail.
; AVX2 kernels end with vzeroupper.
; ============================================================

default rel
%include "abi.inc"

section .text
    global si_vec_add_f32_sse2
    global si_vec_add_f32_avx2
    global si_dot_f32_sse2
    global si_dot_f32_avx2
    global si_sum_i32_sse2
    global si_sum_i32_avx2
    global si_minmax_i32_sse2
    global si_minmax_i32_avx2

; ---------------- vec add ----------------
si_vec_add_f32_sse2:            ; a=ARG1 b=ARG2 out=ARG3 n=ARG4
    xor r10d, r10d
    mov r11, ARG4
    and r11, -4
.v:
    cmp r10, r11
    jae .t
    movups xmm0, [ARG1 + r10*4]
    movups xmm1, [ARG2 + r10*4]
    addps  xmm0, xmm1
    movups [ARG3 + r10*4], xmm0
    add r10, 4
    jmp .v
.t:
    cmp r10, ARG4
    jae .d
    movss xmm0, [ARG1 + r10*4]
    addss xmm0, [ARG2 + r10*4]
    movss [ARG3 + r10*4], xmm0
    inc r10
    jmp .t
.d:
    ret

si_vec_add_f32_avx2:
    xor r10d, r10d
    mov r11, ARG4
    and r11, -8
.v:
    cmp r10, r11
    jae .t
    vmovups ymm0, [ARG1 + r10*4]
    vaddps  ymm0, ymm0, [ARG2 + r10*4]
    vmovups [ARG3 + r10*4], ymm0
    add r10, 8
    jmp .v
.t:
    cmp r10, ARG4
    jae .d
    vmovss xmm0, [ARG1 + r10*4]
    vaddss xmm0, xmm0, [ARG2 + r10*4]
    vmovss [ARG3 + r10*4], xmm0
    inc r10
    jmp .t
.d:
    vzeroupper
    ret

; ---------------- dot product ----------------
si_dot_f32_sse2:                ; a=ARG1 b=ARG2 n=ARG3
    xor r10d, r10d
    mov r11, ARG3
    and r11, -4
    xorps xmm0, xmm0
.v:
    cmp r10, r11
    jae .h
    movups xmm1, [ARG1 + r10*4]
    movups xmm2, [ARG2 + r10*4]
    mulps  xmm1, xmm2
    addps  xmm0, xmm1
    add r10, 4
    jmp .v
.h:                             ; horizontal add of 4 lanes
    movaps xmm1, xmm0
    movhlps xmm1, xmm0
    addps  xmm0, xmm1
    movaps xmm1, xmm0
    shufps xmm1, xmm1, 0x55
    addss  xmm0, xmm1
.t:
    cmp r10, ARG3
    jae .d
    movss xmm1, [ARG1 + r10*4]
    mulss xmm1, [ARG2 + r10*4]
    addss xmm0, xmm1
    inc r10
    jmp .t
.d:
    ret

si_dot_f32_avx2:
    xor r10d, r10d
    mov r11, ARG3
    and r11, -8
    vxorps ymm0, ymm0, ymm0
.v:
    cmp r10, r11
    jae .h
    vmovups ymm1, [ARG1 + r10*4]
    vmulps  ymm1, ymm1, [ARG2 + r10*4]
    vaddps  ymm0, ymm0, ymm1
    add r10, 8
    jmp .v
.h:
    vextractf128 xmm1, ymm0, 1
    vaddps xmm0, xmm0, xmm1
    vmovhlps xmm1, xmm1, xmm0
    vaddps xmm0, xmm0, xmm1
    vshufps xmm1, xmm0, xmm0, 0x55
    vaddss xmm0, xmm0, xmm1
.t:
    cmp r10, ARG3
    jae .d
    vmovss xmm1, [ARG1 + r10*4]
    vmulss xmm1, xmm1, [ARG2 + r10*4]
    vaddss xmm0, xmm0, xmm1
    inc r10
    jmp .t
.d:
    vzeroupper
    ret

; ---------------- sum of int32 -> int64 ----------------
si_sum_i32_sse2:                ; a=ARG1 n=ARG2
    xor r10d, r10d
    mov r11, ARG2
    and r11, -4
    pxor xmm0, xmm0             ; two int64 lanes
.v:
    cmp r10, r11
    jae .h
    movdqu xmm1, [ARG1 + r10*4]
    movdqa xmm2, xmm1
    psrad  xmm2, 31             ; sign mask
    movdqa xmm3, xmm1
    punpckldq xmm3, xmm2        ; low two int32 -> int64
    punpckhdq xmm1, xmm2        ; high two int32 -> int64
    paddq xmm0, xmm3
    paddq xmm0, xmm1
    add r10, 4
    jmp .v
.h:
    movdqa xmm1, xmm0
    psrldq xmm1, 8
    paddq  xmm0, xmm1
    movq   rax, xmm0
.t:
    cmp r10, ARG2
    jae .d
    movsxd r11, dword [ARG1 + r10*4]
    add rax, r11
    inc r10
    jmp .t
.d:
    ret

si_sum_i32_avx2:
    xor r10d, r10d
    mov r11, ARG2
    and r11, -8
    vpxor ymm0, ymm0, ymm0      ; four int64 lanes
.v:
    cmp r10, r11
    jae .h
    vpmovsxdq ymm1, [ARG1 + r10*4]
    vpmovsxdq ymm2, [ARG1 + r10*4 + 16]
    vpaddq ymm0, ymm0, ymm1
    vpaddq ymm0, ymm0, ymm2
    add r10, 8
    jmp .v
.h:
    vextracti128 xmm1, ymm0, 1
    vpaddq xmm0, xmm0, xmm1
    vpsrldq xmm1, xmm0, 8
    vpaddq xmm0, xmm0, xmm1
    vmovq rax, xmm0
.t:
    cmp r10, ARG2
    jae .d
    movsxd r11, dword [ARG1 + r10*4]
    add rax, r11
    inc r10
    jmp .t
.d:
    vzeroupper
    ret

; ---------------- min / max of int32 (single pass) ----------------
; SSE2 has no pminsd/pmaxsd (SSE4.1), so select with a compare mask:
;   min = (src & (dst > src)) | (dst & ~(dst > src))
%macro MIN32 2                  ; %1 = dst (running min), %2 = src ; clobbers xmm3, xmm4
    movdqa xmm3, %1
    pcmpgtd xmm3, %2
    movdqa xmm4, %2
    pand   xmm4, xmm3
    pandn  xmm3, %1
    por    xmm3, xmm4
    movdqa %1, xmm3
%endmacro
%macro MAX32 2                  ; %1 = dst (running max), %2 = src ; clobbers xmm3, xmm4
    movdqa xmm3, %2
    pcmpgtd xmm3, %1
    movdqa xmm4, %2
    pand   xmm4, xmm3
    pandn  xmm3, %1
    por    xmm3, xmm4
    movdqa %1, xmm3
%endmacro

si_minmax_i32_sse2:             ; a=ARG1 n=ARG2 min*=ARG3 max*=ARG4
    test ARG2, ARG2
    jz .d
    mov eax, [ARG1]             ; seed both results with a[0]
    mov [ARG3], eax
    mov [ARG4], eax
    xor r10d, r10d
    mov r11, ARG2
    and r11, -4
    jz .t                       ; fewer than 4 elements: scalar only
    movd xmm0, eax
    pshufd xmm0, xmm0, 0
    movdqa xmm1, xmm0
.v:
    movdqu xmm2, [ARG1 + r10*4]
    MIN32 xmm0, xmm2
    MAX32 xmm1, xmm2
    add r10, 4
    cmp r10, r11
    jb .v
    pshufd xmm2, xmm0, 0x4E
    MIN32 xmm0, xmm2
    pshufd xmm2, xmm0, 0xB1
    MIN32 xmm0, xmm2
    movd eax, xmm0
    mov [ARG3], eax
    pshufd xmm2, xmm1, 0x4E
    MAX32 xmm1, xmm2
    pshufd xmm2, xmm1, 0xB1
    MAX32 xmm1, xmm2
    movd eax, xmm1
    mov [ARG4], eax
.t:
    cmp r10, ARG2
    jae .d
    mov eax, [ARG1 + r10*4]
    cmp eax, [ARG3]
    jge .a
    mov [ARG3], eax
.a:
    cmp eax, [ARG4]
    jle .b
    mov [ARG4], eax
.b:
    inc r10
    jmp .t
.d:
    ret

si_minmax_i32_avx2:
    test ARG2, ARG2
    jz .d
    mov eax, [ARG1]
    mov [ARG3], eax
    mov [ARG4], eax
    xor r10d, r10d
    mov r11, ARG2
    and r11, -8
    jz .t
    vmovd xmm0, eax
    vpbroadcastd ymm0, xmm0
    vmovdqa ymm1, ymm0
.v:
    vmovdqu ymm2, [ARG1 + r10*4]
    vpminsd ymm0, ymm0, ymm2
    vpmaxsd ymm1, ymm1, ymm2
    add r10, 8
    cmp r10, r11
    jb .v
    vextracti128 xmm2, ymm0, 1
    vpminsd xmm0, xmm0, xmm2
    vpshufd xmm2, xmm0, 0x4E
    vpminsd xmm0, xmm0, xmm2
    vpshufd xmm2, xmm0, 0xB1
    vpminsd xmm0, xmm0, xmm2
    vmovd eax, xmm0
    mov [ARG3], eax
    vextracti128 xmm2, ymm1, 1
    vpmaxsd xmm1, xmm1, xmm2
    vpshufd xmm2, xmm1, 0x4E
    vpmaxsd xmm1, xmm1, xmm2
    vpshufd xmm2, xmm1, 0xB1
    vpmaxsd xmm1, xmm1, xmm2
    vmovd eax, xmm1
    mov [ARG4], eax
.t:
    cmp r10, ARG2
    jae .d
    mov eax, [ARG1 + r10*4]
    cmp eax, [ARG3]
    jge .a
    mov [ARG3], eax
.a:
    cmp eax, [ARG4]
    jle .b
    mov [ARG4], eax
.b:
    inc r10
    jmp .t
.d:
    vzeroupper
    ret

%ifidn __OUTPUT_FORMAT__, elf64
section .note.GNU-stack noalloc noexec nowrite
%endif
