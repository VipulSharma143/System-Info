cmake_minimum_required(VERSION 3.10)
project(SystemMonitorNative)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

enable_language(ASM_NASM)
set(CMAKE_ASM_NASM_OBJECT_FORMAT elf64)

# Pick the correct platform-specific source file at configure time
if(WIN32)
    set(PLATFORM_SOURCE src/windows_provider.cpp)
else()
    set(PLATFORM_SOURCE src/linux_provider.cpp)
endif()

add_library(systemmonitor_native SHARED
    src/common.cpp
    ${PLATFORM_SOURCE}
    ../assembly/get_constant.asm
    ../assembly/benchmark_loop.asm
    ../assembly/simd_loop.asm
)

if(NOT WIN32)
    target_link_libraries(systemmonitor_native stdc++fs)
endif()