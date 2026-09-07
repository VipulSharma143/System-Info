; ============================================================
; get_constant.asm — smallest possible Assembly function
; Proves: NASM can build something C++ can call
; ============================================================

section .text
    global get_constant   ; makes this function visible to the linker (like extern "C" in C++)

get_constant:
    ; x86-64 System V calling convention: return value goes in the RAX register
    mov eax, 42           ; move the number 42 into EAX (lower 32 bits of RAX)
    ret                   ; return — whatever's in EAX is the "return value"

section .note.GNU-stack noalloc noexec nowrite