; ============================================================
; memory/memory_kernels.asm — bulk memory kernels (SSE2 baseline + AVX2 variants).
;
; (A hand-written memcpy lived here until 2.4.8. Measured against libc memcpy it was never faster, 0.95-1.0x, so it
; was removed: libc's is already vectorised and tuned per CPU. Do not re-add it without a benchmark that beats libc.)
;
;   si_xor_u64_{sse2,avx2} (const uint64_t* a, size_t nwords)       -> uint64 (rax)
;
; Same register/ABI rules as math/vector_math.asm.
; ============================================================

default rel
%include "abi.inc"

section .text
    global si_xor_u64_sse2
    global si_xor_u64_avx2

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
