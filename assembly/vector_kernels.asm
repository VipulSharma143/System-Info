; ============================================================
; vector_kernels.asm — real numeric kernels used by the native benchmark
; and CPU self-test. Each kernel exists in an SSE2 form (x86-64 baseline,
; always safe) and an AVX2 form (only ever called after the C++ dispatcher
; has confirmed CPUID AVX2 *and* OS YMM state support via XGETBV).
;
;   si_vec_add_f32_{sse2,avx2}(const float* a, const float* b, float* out, size_t n)
;   si_dot_f32_{sse2,avx2}    (const float* a, const float* b, size_t n)      -> float  (xmm0)
;   si_sum_i32_{sse2,avx2}    (const int32_t* a, size_t n)                    -> int64  (rax)
;
;   si_minmax_i32_{sse2,avx2}  (const int32_t* a, size_t n, int32_t* min, int32_t* max)  (n>=1; n==0 is a no-op)
;   si_memcpy_{sse2,avx2}      (void* dst, const void* src, size_t n)           (regions must NOT overlap)
;   si_xor_u64_{sse2,avx2}     (const uint64_t* a, size_t nwords)               -> uint64 (rax)
;
; ABI: arguments arrive in RCX,RDX,R8,R9 (Windows x64) or RDI,RSI,RDX,RCX
; (System V). Only volatile registers are used (RAX,R10,R11, XMM0-5/YMM0-5),
; so nothing needs saving — XMM6-15 (callee-saved on Windows) are never
; touched. No stack use, so alignment is irrelevant. All loads/stores are
; unaligned (movups / vmovups). n == 0 and n < vector width fall straight
; through to the scalar tail. AVX2 kernels end with vzeroupper.
; ============================================================

default rel

%ifidn __OUTPUT_FORMAT__, win64
    %define ARG1 rcx
    %define ARG2 rdx
    %define ARG3 r8
    %define ARG4 r9
%else
    %define ARG1 rdi
    %define ARG2 rsi
    %define ARG3 rdx
    %define ARG4 rcx
%endif

section .text
    global si_vec_add_f32_sse2
    global si_vec_add_f32_avx2
    global si_dot_f32_sse2
    global si_dot_f32_avx2
    global si_sum_i32_sse2
    global si_sum_i32_avx2
    global si_minmax_i32_sse2
    global si_minmax_i32_avx2
    global si_memcpy_sse2
    global si_memcpy_avx2
    global si_xor_u64_sse2
    global si_xor_u64_avx2

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

; ---------------- memcpy (non-overlapping) ----------------
; 64 B (SSE2) / 128 B (AVX2) unrolled main loop, then one vector per step,
; then a byte tail. All accesses unaligned; the C++ wrapper falls back to
; memmove when the regions overlap.
si_memcpy_sse2:                 ; dst=ARG1 src=ARG2 n=ARG3
    xor r10d, r10d
    mov r11, ARG3
    and r11, -64
.b64:
    cmp r10, r11
    jae .v16
    movdqu xmm0, [ARG2 + r10]
    movdqu xmm1, [ARG2 + r10 + 16]
    movdqu xmm2, [ARG2 + r10 + 32]
    movdqu xmm3, [ARG2 + r10 + 48]
    movdqu [ARG1 + r10], xmm0
    movdqu [ARG1 + r10 + 16], xmm1
    movdqu [ARG1 + r10 + 32], xmm2
    movdqu [ARG1 + r10 + 48], xmm3
    add r10, 64
    jmp .b64
.v16:
    mov r11, ARG3
    and r11, -16
.l16:
    cmp r10, r11
    jae .t
    movdqu xmm0, [ARG2 + r10]
    movdqu [ARG1 + r10], xmm0
    add r10, 16
    jmp .l16
.t:
    cmp r10, ARG3
    jae .d
    mov al, [ARG2 + r10]
    mov [ARG1 + r10], al
    inc r10
    jmp .t
.d:
    ret

si_memcpy_avx2:
    xor r10d, r10d
    mov r11, ARG3
    and r11, -128
.b128:
    cmp r10, r11
    jae .v32
    vmovdqu ymm0, [ARG2 + r10]
    vmovdqu ymm1, [ARG2 + r10 + 32]
    vmovdqu ymm2, [ARG2 + r10 + 64]
    vmovdqu ymm3, [ARG2 + r10 + 96]
    vmovdqu [ARG1 + r10], ymm0
    vmovdqu [ARG1 + r10 + 32], ymm1
    vmovdqu [ARG1 + r10 + 64], ymm2
    vmovdqu [ARG1 + r10 + 96], ymm3
    sub r10, -128
    jmp .b128
.v32:
    mov r11, ARG3
    and r11, -32
.l32:
    cmp r10, r11
    jae .t
    vmovdqu ymm0, [ARG2 + r10]
    vmovdqu [ARG1 + r10], ymm0
    add r10, 32
    jmp .l32
.t:
    cmp r10, ARG3
    jae .d
    mov al, [ARG2 + r10]
    mov [ARG1 + r10], al
    inc r10
    jmp .t
.d:
    vzeroupper
    ret

; ---------------- XOR checksum of 64-bit words ----------------
; A pure read workload (one load per 8 bytes, one XOR): the C++ bandwidth
; benchmark uses it to measure sustained read throughput, and it doubles as
; an integrity checksum because XOR-reduction is order independent.
si_xor_u64_sse2:                ; a=ARG1 nwords=ARG2 -> rax
    xor r10d, r10d
    mov r11, ARG2
    and r11, -2
    pxor xmm0, xmm0
.v:
    cmp r10, r11
    jae .h
    movdqu xmm1, [ARG1 + r10*8]
    pxor xmm0, xmm1
    add r10, 2
    jmp .v
.h:
    movdqa xmm1, xmm0
    psrldq xmm1, 8
    pxor xmm0, xmm1
    movq rax, xmm0
.t:
    cmp r10, ARG2
    jae .d
    xor rax, [ARG1 + r10*8]
    inc r10
    jmp .t
.d:
    ret

si_xor_u64_avx2:
    xor r10d, r10d
    mov r11, ARG2
    and r11, -8
    vpxor ymm0, ymm0, ymm0
    vpxor ymm1, ymm1, ymm1
.v8:                            ; two independent accumulators hide load latency
    cmp r10, r11
    jae .v4
    vpxor ymm0, ymm0, [ARG1 + r10*8]
    vpxor ymm1, ymm1, [ARG1 + r10*8 + 32]
    add r10, 8
    jmp .v8
.v4:
    mov r11, ARG2
    and r11, -4
    cmp r10, r11
    jae .h
    vpxor ymm0, ymm0, [ARG1 + r10*8]
    add r10, 4
.h:
    vpxor ymm0, ymm0, ymm1
    vextracti128 xmm1, ymm0, 1
    vpxor xmm0, xmm0, xmm1
    vpsrldq xmm1, xmm0, 8
    vpxor xmm0, xmm0, xmm1
    vmovq rax, xmm0
.t:
    cmp r10, ARG2
    jae .d
    xor rax, [ARG1 + r10*8]
    inc r10
    jmp .t
.d:
    vzeroupper
    ret


%ifidn __OUTPUT_FORMAT__, elf64
section .note.GNU-stack noalloc noexec nowrite
%endif
