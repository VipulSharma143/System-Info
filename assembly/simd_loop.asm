; ============================================================
; simd_loop.asm — scalar vs SIMD (SSE2) comparison
; Both versions do the same total work (add + xor per element)
; so throughput can be compared fairly.
; ============================================================

default rel             ; use RIP-relative addressing (required for shared libraries)

section .data
    align 16
    counter_init:  dd 0, 1, 2, 3      ; four 32-bit lanes: initial counter values
    increment_vec: dd 4, 4, 4, 4      ; added to counter each loop (4 elements processed per pass)

section .text
    global run_benchmark_loop_scalar_compare
    global run_benchmark_loop_simd

; ------------------------------------------------------------
; Scalar baseline: one element per iteration, add + xor
; ------------------------------------------------------------
run_benchmark_loop_scalar_compare:
    xor rax, rax           ; accumulator = 0
    xor rcx, rcx           ; counter = 0

.loop:
    add rax, rcx
    xor rax, rcx
    inc rcx
    cmp rcx, rdi            ; rdi = iterations (passed in from C++)
    jl .loop

    ret

; ------------------------------------------------------------
; SIMD (SSE2): four elements per iteration, same add + xor work
; ------------------------------------------------------------
run_benchmark_loop_simd:
    pxor xmm0, xmm0                 ; accumulator vector = [0,0,0,0]
    movdqu xmm1, [counter_init]     ; counter vector = [0,1,2,3]
    movdqu xmm2, [increment_vec]    ; increment vector = [4,4,4,4]

    mov rcx, rdi
    shr rcx, 2                      ; rcx = iterations / 4 (SIMD processes 4 at once)

.loop:
    paddd xmm0, xmm1                ; accumulator += counter (4 lanes at once)
    pxor xmm0, xmm1                 ; accumulator ^= counter (4 lanes at once)
    paddd xmm1, xmm2                ; counter += 4 (advance all lanes)
    dec rcx
    jnz .loop

    ; horizontally sum the 4 lanes into a single value (proves real work happened)
    pshufd xmm3, xmm0, 0x4E
    paddd xmm0, xmm3
    pshufd xmm3, xmm0, 0xB1
    paddd xmm0, xmm3
    movd eax, xmm0                  ; result in eax (upper 32 bits of rax auto-zeroed)

    ret

section .note.GNU-stack noalloc noexec nowrite
