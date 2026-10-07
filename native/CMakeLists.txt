cmake_minimum_required(VERSION 3.10)
project(SystemMonitorNative)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
# Only functions marked NATIVE_API are part of the library's ABI.
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)

enable_language(ASM_NASM)

# Kernels share assembly/abi.inc (argument-register macros).
set(ASM_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../assembly)

if(WIN32)
    set(CMAKE_ASM_NASM_OBJECT_FORMAT win64)
    set(PLATFORM_DIR platform/windows)
    set(PLATFORM_SOURCES
        ${PLATFORM_DIR}/cpu.cpp
        ${PLATFORM_DIR}/storage.cpp
        ${PLATFORM_DIR}/fan.cpp
        ${PLATFORM_DIR}/memory.cpp
        ${PLATFORM_DIR}/smbios_source.cpp
        ${PLATFORM_DIR}/snapshot_writer.cpp
        ${PLATFORM_DIR}/provider.cpp)
else()
    set(CMAKE_ASM_NASM_OBJECT_FORMAT elf64)
    set(PLATFORM_DIR platform/linux)
    set(PLATFORM_SOURCES
        ${PLATFORM_DIR}/cpu.cpp
        ${PLATFORM_DIR}/storage.cpp
        ${PLATFORM_DIR}/fan.cpp
        ${PLATFORM_DIR}/memory.cpp
        ${PLATFORM_DIR}/smbios_source.cpp
        ${PLATFORM_DIR}/snapshot_writer.cpp
        ${PLATFORM_DIR}/provider.cpp)
endif()

# Compiled once; the shared library and the white-box loader test both reuse these objects.
add_library(systemmonitor_objects OBJECT
    src/common.cpp
    src/simd_dispatch.cpp
    src/cpu_temperature.cpp
    src/host_snapshot.cpp
    src/smbios/reader.cpp
    src/smbios/table_source.cpp
    src/smbios/decode.cpp
    src/smbios/parser.cpp
    src/smbios/memory_dimm.cpp
    ${PLATFORM_SOURCES}
    ${ASM_DIR}/cpu/get_constant.asm
    ${ASM_DIR}/cpu/benchmark_loop.asm
    ${ASM_DIR}/cpu/simd_loop.asm
    ${ASM_DIR}/math/vector_math.asm
    ${ASM_DIR}/memory/memory_kernels.asm
)

target_include_directories(systemmonitor_objects PRIVATE ${ASM_DIR})

add_library(systemmonitor_native SHARED $<TARGET_OBJECTS:systemmonitor_objects>)

if(NOT WIN32)
    target_link_libraries(systemmonitor_native stdc++fs)
else()
    # platform/windows/provider.cpp relies on #pragma comment(lib, "dxgi.lib") for
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

    # CPU temperature sensor selection against fake sysfs trees (no hardware needed).
    add_executable(cpu_temperature_test ../tests/native/cpu_temperature_test.cpp)
    target_link_libraries(cpu_temperature_test systemmonitor_native)
    add_test(NAME cpu_temperature_test COMMAND cpu_temperature_test)
    set_tests_properties(cpu_temperature_test PROPERTIES TIMEOUT 30)

    # Logical-processor identity and hybrid core classes: parser, fake /sys tree, live self-consistency.
    add_executable(cpu_logical_test ../tests/native/cpu_logical_test.cpp)
    target_link_libraries(cpu_logical_test systemmonitor_native)
    add_test(NAME cpu_logical_test COMMAND cpu_logical_test)
    set_tests_properties(cpu_logical_test PROPERTIES TIMEOUT 30)

    # Assembly tiers: normal run, then the SYSTEMINFO_NO_ASM kill switch (must pick the portable tier, same answers).
    add_executable(asm_tiers_test ../tests/native/asm_tiers_test.cpp)
    target_link_libraries(asm_tiers_test systemmonitor_native)
    add_test(NAME asm_tiers_test COMMAND asm_tiers_test)
    add_test(NAME asm_tiers_test_no_asm COMMAND asm_tiers_test no-asm)
    set_tests_properties(asm_tiers_test_no_asm PROPERTIES ENVIRONMENT "SYSTEMINFO_NO_ASM=1")
    set_tests_properties(asm_tiers_test asm_tiers_test_no_asm PROPERTIES TIMEOUT 60)

    # Host snapshot: pure parsers against fixture text, plus a live sanity read. No hardware assumptions.
    add_executable(host_snapshot_test ../tests/native/host_snapshot_test.cpp)
    target_link_libraries(host_snapshot_test systemmonitor_native)
    add_test(NAME host_snapshot_test COMMAND host_snapshot_test)
    set_tests_properties(host_snapshot_test PROPERTIES TIMEOUT 30)

    # SMBIOS Type 16/17 parser against hand-built tables: no hardware, no root,
    # identical on Linux and Windows.
    add_executable(smbios_parse_test ../tests/native/smbios_parse_test.cpp)
    target_link_libraries(smbios_parse_test systemmonitor_native)
    add_test(NAME smbios_parse_test COMMAND smbios_parse_test)
    set_tests_properties(smbios_parse_test PROPERTIES TIMEOUT 60)

    # RawSMBIOSData header handling and the Linux snapshot format. Needs internal (non-exported)
    # functions, so it links the shared objects directly rather than the library.
    add_executable(smbios_loader_test ../tests/native/smbios_loader_test.cpp $<TARGET_OBJECTS:systemmonitor_objects>)
    if(WIN32)
        target_link_libraries(smbios_loader_test dxgi psapi)
    else()
        target_link_libraries(smbios_loader_test stdc++fs)
    endif()
    add_test(NAME smbios_loader_test COMMAND smbios_loader_test)
    set_tests_properties(smbios_loader_test PROPERTIES TIMEOUT 30)
endif()
