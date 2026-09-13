; ============================================================
; simd_loop.asm — scalar vs SIMD (SSE2) comparison
; Both versions do the same total work (add + xor per element)
; so throughput can be compared fairly.
; ============================================================

default rel

%ifidn __OUTPUT_FORMAT__, win64
    %define ARG1 rcx
%else
    %define ARG1 rdi
%endif

section .data
    align 16
    counter_init:  dd 0, 1, 2, 3
    increment_vec: dd 4, 4, 4, 4

section .text
    global run_benchmark_loop_scalar_compare
    global run_benchmark_loop_simd

run_benchmark_loop_scalar_compare:
    mov r9, ARG1
    xor rax, rax
    xor rcx, rcx

.loop:
    add rax, rcx
    xor rax, rcx
    inc rcx
    cmp rcx, r9
    jl .loop

    ret

run_benchmark_loop_simd:
    mov r9, ARG1
    pxor xmm0, xmm0
    movdqu xmm1, [counter_init]
    movdqu xmm2, [increment_vec]

    mov rcx, r9
    shr rcx, 2

.loop:
    paddd xmm0, xmm1
    pxor xmm0, xmm1
    paddd xmm1, xmm2
    dec rcx
    jnz .loop

    pshufd xmm3, xmm0, 0x4E
    paddd xmm0, xmm3
    pshufd xmm3, xmm0, 0xB1
    paddd xmm0, xmm3
    movd eax, xmm0

    ret

%ifidn __OUTPUT_FORMAT__, elf64
section .note.GNU-stack noalloc noexec nowrite
%endif