; ============================================================
; get_constant.asm — smallest possible Assembly function
; Proves: NASM can build something C++ can call
; ============================================================

section .text
    global get_constant

get_constant:
    mov eax, 42
    ret

%ifidn __OUTPUT_FORMAT__, elf64
section .note.GNU-stack noalloc noexec nowrite
%endif