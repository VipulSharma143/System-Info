; ============================================================
; benchmark_loop.asm — tight arithmetic loop for CPU benchmarking
; Does real, non-trivial work N times so timing it means something
; ============================================================

section .text
    global run_benchmark_loop

; run_benchmark_loop(long iterations)
; System V x86-64 calling convention: first integer arg arrives in RDI
; Return value goes in RAX
run_benchmark_loop:
    xor rax, rax          ; accumulator = 0 (this is our "result", proves the loop isn't optimized away)
    xor rcx, rcx          ; counter = 0

.loop:
    add rax, rcx           ; accumulator += counter  (real arithmetic work)
    imul rax, rax, 3        ; accumulator *= 3        (more work — avoids trivial pattern)
    xor rax, rcx            ; accumulator ^= counter  (more work)
    inc rcx                 ; counter++
    cmp rcx, rdi             ; compare counter to iterations (the arg passed in RDI)
    jl .loop                 ; jump back to .loop if counter < iterations

    ret                       ; RAX still holds the accumulated result

section .note.GNU-stack noalloc noexec nowrite
