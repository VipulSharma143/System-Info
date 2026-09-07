cmake_minimum_required(VERSION 3.10)
project(SystemMonitorNative)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Tell CMake how to assemble .asm files with NASM into object files
enable_language(ASM_NASM)
set(CMAKE_ASM_NASM_OBJECT_FORMAT elf64)

add_library(systemmonitor_native SHARED
    src/native_engine.cpp
    ../assembly/get_constant.asm
    ../assembly/benchmark_loop.asm
    ../assembly/simd_loop.asm
)

target_link_libraries(systemmonitor_native stdc++fs)