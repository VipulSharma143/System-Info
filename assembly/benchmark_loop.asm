; ============================================================
; benchmark_loop.asm — tight arithmetic loop for CPU benchmarking
; Does real, non-trivial work N times so timing it means something
; ============================================================

section .text
    global run_benchmark_loop

%ifidn __OUTPUT_FORMAT__, win64
    %define ARG1 rcx
%else
    %define ARG1 rdi
%endif

; run_benchmark_loop(long iterations)
; NASM sets __OUTPUT_FORMAT__ automatically from the -f flag CMake passes,
; so this one file assembles correctly for both System V (elf64) and
; Windows x64 (win64) without needing a separate source per platform.
run_benchmark_loop:
    mov r9, ARG1           ; stash iterations somewhere neither convention uses
    xor rax, rax           ; accumulator
    xor rcx, rcx           ; counter (safe now — arg already copied out of rcx)

.loop:
    add rax, rcx
    imul rax, rax, 3
    xor rax, rcx
    inc rcx
    cmp rcx, r9
    jl .loop

    ret

%ifidn __OUTPUT_FORMAT__, elf64
section .note.GNU-stack noalloc noexec nowrite
%endif