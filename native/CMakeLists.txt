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
    src/simd_dispatch.cpp
    src/hardware_info.cpp
    ${PLATFORM_SOURCE}
    ../assembly/get_constant.asm
    ../assembly/benchmark_loop.asm
    ../assembly/simd_loop.asm
    ../assembly/vector_kernels.asm
)

if(NOT WIN32)
    target_link_libraries(systemmonitor_native stdc++fs)
else()
    # windows_provider.cpp relies on #pragma comment(lib, "dxgi.lib") for
    # DXGI (CreateDXGIFactory), which only MSVC honors. Declaring it here too
    # means the link doesn't silently depend on a compiler-specific pragma.
    target_link_libraries(systemmonitor_native dxgi)
endif()

# Native tests: cmake -DBUILD_NATIVE_TESTS=ON .. && cmake --build . && ctest --output-on-failure
option(BUILD_NATIVE_TESTS "Build native engine tests" OFF)
if(BUILD_NATIVE_TESTS)
    enable_testing()
    add_executable(kernel_selftest ../tests/native/kernel_selftest.cpp)
    target_link_libraries(kernel_selftest systemmonitor_native)
    add_test(NAME kernel_selftest COMMAND kernel_selftest)
    set_tests_properties(kernel_selftest PROPERTIES TIMEOUT 60)
endif()
