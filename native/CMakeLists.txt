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
    target_link_libraries(systemmonitor_native dxgi psapi)
endif()

# Linux only: root helper that saves the memory records of the firmware table
# for the unprivileged app (see tools/smbios_snapshot.cpp). $ORIGIN lets it find
# the library when both are copied to the same folder.
if(NOT WIN32)
    add_executable(si_smbios_snapshot tools/smbios_snapshot.cpp)
    target_link_libraries(si_smbios_snapshot systemmonitor_native)
    set_target_properties(si_smbios_snapshot PROPERTIES
        BUILD_RPATH "$ORIGIN"
        INSTALL_RPATH "$ORIGIN")
endif()

# Native tests: cmake -DBUILD_NATIVE_TESTS=ON .. && cmake --build . && ctest --output-on-failure
option(BUILD_NATIVE_TESTS "Build native engine tests" OFF)
if(BUILD_NATIVE_TESTS)
    enable_testing()

    add_executable(kernel_selftest ../tests/native/kernel_selftest.cpp)
    target_link_libraries(kernel_selftest systemmonitor_native)
    add_test(NAME kernel_selftest COMMAND kernel_selftest)
    set_tests_properties(kernel_selftest PROPERTIES TIMEOUT 60)

    add_executable(memory_info_test ../tests/native/memory_info_test.cpp)
    target_link_libraries(memory_info_test systemmonitor_native)
    add_test(NAME memory_info_test COMMAND memory_info_test)
    set_tests_properties(memory_info_test PROPERTIES TIMEOUT 30)
    

    add_executable(memory_hardware_test ../tests/native/memory_hardware_test.cpp)
    target_link_libraries(memory_hardware_test systemmonitor_native)
    add_test(NAME memory_hardware_test COMMAND memory_hardware_test)
    set_tests_properties(memory_hardware_test PROPERTIES TIMEOUT 30)

    # SMBIOS Type 16/17 parser against hand-built tables: no hardware, no root,
    # identical on Linux and Windows.
    add_executable(smbios_parse_test ../tests/native/smbios_parse_test.cpp)
    target_link_libraries(smbios_parse_test systemmonitor_native)
    add_test(NAME smbios_parse_test COMMAND smbios_parse_test)
    set_tests_properties(smbios_parse_test PROPERTIES TIMEOUT 60)

    # Windows RawSMBIOSData header handling. This test #includes hardware_info.cpp
    # to reach a static helper, so it is built standalone (not linked against
    # systemmonitor_native, which would duplicate every symbol).
    add_executable(smbios_loader_test ../tests/native/smbios_loader_test.cpp)
    if(WIN32)
        target_link_libraries(smbios_loader_test dxgi psapi)
    else()
        target_link_libraries(smbios_loader_test stdc++fs)
    endif()
    add_test(NAME smbios_loader_test COMMAND smbios_loader_test)
    set_tests_properties(smbios_loader_test PROPERTIES TIMEOUT 30)
endif()
