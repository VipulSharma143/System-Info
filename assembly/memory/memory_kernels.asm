; ============================================================
; memory/memory_kernels.asm — bulk memory kernels (SSE2 baseline + AVX2 variants).
;
;   si_memcpy_{sse2,avx2}  (void* dst, const void* src, size_t n)   (regions must NOT overlap)
;   si_xor_u64_{sse2,avx2} (const uint64_t* a, size_t nwords)       -> uint64 (rax)
;
; Same register/ABI rules as math/vector_math.asm.
; ============================================================

default rel
%include "abi.inc"

section .text
    global si_memcpy_sse2
    global si_memcpy_avx2
    global si_xor_u64_sse2
    global si_xor_u64_avx2

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
