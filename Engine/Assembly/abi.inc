; abi.inc — argument registers for the kernels in this folder.
; Windows x64 passes the first four integer arguments in RCX,RDX,R8,R9; System V in RDI,RSI,RDX,RCX.
; Only volatile registers are used by the kernels, so nothing has to be saved.

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
