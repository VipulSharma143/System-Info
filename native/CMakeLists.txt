cmake_minimum_required(VERSION 3.10)
project(SystemMonitorNative)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

enable_language(ASM_NASM)

if(WIN32)
    set(CMAKE_ASM_NASM_OBJECT_FORMAT win64)
    set(PLATFORM_SOURCE src/windows_provider.cpp)
else()
    set(CMAKE_ASM_NASM_OBJECT_FORMAT elf64)
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
else()
    # windows_provider.cpp relies on #pragma comment(lib, "dxgi.lib") for
    # DXGI (CreateDXGIFactory), which only MSVC honors. Declaring it here too
    # means the link doesn't silently depend on a compiler-specific pragma.
    target_link_libraries(systemmonitor_native dxgi)
endif()