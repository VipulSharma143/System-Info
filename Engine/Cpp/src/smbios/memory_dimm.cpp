// Exported physical-RAM API (DIMM modules, hardware summary, availability status).
#include "smbios.h"

#include <cctype>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

// =====================================================================
// Public DIMM API
// =====================================================================

int si_memory_module_impl(
    const unsigned char* tbl,
    size_t len,
    int index,
    char* manufacturerOut,
    int manufacturerSize,
    char* partNumberOut,
    int partNumberSize,
    char* serialNumberOut,
    int serialNumberSize,
    char* locatorOut,
    int locatorSize,
    char* bankLocatorOut,
    int bankLocatorSize,
    char* formFactorOut,
    int formFactorSize,
    char* memoryTypeOut,
    int memoryTypeSize,
    long long* capacityBytesOut,
    long long* speedMTsOut,
    long long* configuredSpeedMTsOut,
    int* dataWidthOut,
    int* totalWidthOut,
    int* rankOut,
    int* eccOut) {

    // ---------------------------------------------------------------
    // Initialize all outputs first.
    // ---------------------------------------------------------------

    copy_out(
        manufacturerOut,
        manufacturerSize,
        {}
    );

    copy_out(
        partNumberOut,
        partNumberSize,
        {}
    );

    copy_out(
        serialNumberOut,
        serialNumberSize,
        {}
    );

    copy_out(
        locatorOut,
        locatorSize,
        {}
    );

    copy_out(
        bankLocatorOut,
        bankLocatorSize,
        {}
    );

    copy_out(
        formFactorOut,
        formFactorSize,
        {}
    );

    copy_out(
        memoryTypeOut,
        memoryTypeSize,
        {}
    );

    si_mem_put(
        capacityBytesOut,
        -1
    );

    si_mem_put(
        speedMTsOut,
        -1
    );

    si_mem_put(
        configuredSpeedMTsOut,
        -1
    );

    if (dataWidthOut)
        *dataWidthOut = -1;

    if (totalWidthOut)
        *totalWidthOut = -1;

    if (rankOut)
        *rankOut = -1;

    if (eccOut)
        *eccOut = -1;

    if (index < 0)
        return 0;

    try {
        std::vector<SiDmiMemoryArray>
            arrays;

        std::vector<SiDmiMemoryModule>
            modules;

        if (!si_dmi_get_memory_module(
                tbl,
                len,
                index,
                arrays,
                modules)) {
            return 0;
        }

        if (index >=
            static_cast<int>(
                modules.size())) {
            return 0;
        }

        const auto& module =
            modules[
                static_cast<size_t>(
                    index
                )
            ];

        copy_out(
            manufacturerOut,
            manufacturerSize,
            module.manufacturer
        );

        copy_out(
            partNumberOut,
            partNumberSize,
            module.partNumber
        );

        copy_out(
            serialNumberOut,
            serialNumberSize,
            module.serialNumber
        );

        copy_out(
            locatorOut,
            locatorSize,
            module.locator
        );

        copy_out(
            bankLocatorOut,
            bankLocatorSize,
            module.bankLocator
        );

        copy_out(
            formFactorOut,
            formFactorSize,
            si_memory_form_factor(
                module.formFactor
            )
        );

        copy_out(
            memoryTypeOut,
            memoryTypeSize,
            si_memory_type(
                module.memoryType
            )
        );

        si_mem_put(
            capacityBytesOut,
            module.capacityBytes
        );

        si_mem_put(
            speedMTsOut,
            module.speedMTs
        );

        si_mem_put(
            configuredSpeedMTsOut,
            module.configuredSpeedMTs
        );

        if (dataWidthOut)
            *dataWidthOut =
                module.dataWidth;

        if (totalWidthOut)
            *totalWidthOut =
                module.totalWidth;

        if (rankOut)
            *rankOut =
                module.rank;

        // ECC belongs to the physical memory array.
        for (const auto& array :
             arrays) {

            if (array.handle !=
                module.arrayHandle) {
                continue;
            }

            if (eccOut) {

                *eccOut =
                    si_dmi_ecc_value(
                        array.errorCorrection
                    );
            }

            break;
        }

        return 1;
    }
    catch (...) {
        return 0;
    }
}

// =====================================================================
// Physical RAM hardware summary
// =====================================================================

int si_memory_hardware_summary_impl(
    const unsigned char* tbl,
    size_t len,
    long long* installedBytesOut,
    int* moduleCountOut,
    int* slotCountOut,
    long long* maxCapacityBytesOut,
    long long* maxModuleCapacityBytesOut) {

    si_mem_put(
        installedBytesOut,
        -1
    );

    if (moduleCountOut)
        *moduleCountOut = -1;

    if (slotCountOut)
        *slotCountOut = -1;

    si_mem_put(
        maxCapacityBytesOut,
        -1
    );

    si_mem_put(
        maxModuleCapacityBytesOut,
        -1
    );

    try {
        std::vector<SiDmiMemoryArray>
            arrays;

        std::vector<SiDmiMemoryModule>
            modules;

        if (!si_dmi_read_memory_devices(
                tbl,
                len,
                arrays,
                modules)) {
            return 0;
        }

        // ------------------------------------------------------------
        // Installed physical capacity
        // ------------------------------------------------------------

        long long installed = 0;

        // Type 16 arrays with no populated Type 17 devices (some VMs) say
        // nothing about how much RAM is installed. Reporting 0 there would
        // be a fabricated zero, so the total stays unknown.
        bool installedKnown = !modules.empty();

        for (const auto& module :
             modules) {

            if (module.capacityBytes < 0) {

                installedKnown = false;

                continue;
            }

            if (installed >
                LLONG_MAX -
                    module.capacityBytes) {

                installedKnown = false;

                break;
            }

            installed +=
                module.capacityBytes;
        }

        if (installedKnown) {

            si_mem_put(
                installedBytesOut,
                installed
            );
        }

        // Number of populated Type 17 devices.
        if (moduleCountOut) {

            *moduleCountOut =
                static_cast<int>(
                    modules.size()
                );
        }

        // ------------------------------------------------------------
        // Type 16 array capacity / slot count
        // ------------------------------------------------------------
        //
        // Important:
        //
        // We only report the aggregate when every discovered Type 16
        // array provides a valid value.
        //
        // Reporting "16 GB" from one known array while silently
        // ignoring another unknown array would be misleading.
        //

        long long maxCapacity = 0;

        bool maxCapacityKnown =
            !arrays.empty();

        int slotCount = 0;

        bool slotCountKnown =
            !arrays.empty();

        for (const auto& array :
             arrays) {

            if (array.maxCapacityBytes < 0) {

                maxCapacityKnown =
                    false;
            }
            else if (
                maxCapacity >
                LLONG_MAX -
                    array.maxCapacityBytes) {

                maxCapacityKnown =
                    false;
            }
            else {

                maxCapacity +=
                    array.maxCapacityBytes;
            }

            if (array.slotCount < 0) {

                slotCountKnown =
                    false;
            }
            else if (
                slotCount >
                INT_MAX -
                    array.slotCount) {

                slotCountKnown =
                    false;
            }
            else {

                slotCount +=
                    array.slotCount;
            }
        }

        if (maxCapacityKnown) {

            si_mem_put(
                maxCapacityBytesOut,
                maxCapacity
            );
        }

        if (slotCountOut &&
            slotCountKnown) {

            *slotCountOut =
                slotCount;
        }

        // ------------------------------------------------------------
        // Maximum capacity of one module
        // ------------------------------------------------------------
        //
        // Deliberately unknown.
        //
        // Type 16 tells us the maximum capacity of the physical
        // memory array. It does NOT safely give a per-slot maximum.
        //
        // Never calculate:
        //
        //     max array capacity / number of slots
        //
        // because that would be an inference.
        //

        si_mem_put(
            maxModuleCapacityBytesOut,
            -1
        );

        return 1;
    }
    catch (...) {
        return 0;
    }
}

// =====================================================================
// Public entry points
// =====================================================================

int si_get_memory_module(
    int index,
    char* manufacturerOut, int manufacturerSize,
    char* partNumberOut, int partNumberSize,
    char* serialNumberOut, int serialNumberSize,
    char* locatorOut, int locatorSize,
    char* bankLocatorOut, int bankLocatorSize,
    char* formFactorOut, int formFactorSize,
    char* memoryTypeOut, int memoryTypeSize,
    long long* capacityBytesOut,
    long long* speedMTsOut,
    long long* configuredSpeedMTsOut,
    int* dataWidthOut,
    int* totalWidthOut,
    int* rankOut,
    int* eccOut) {

    return si_memory_module_impl(
        nullptr, 0, index,
        manufacturerOut, manufacturerSize, partNumberOut, partNumberSize,
        serialNumberOut, serialNumberSize, locatorOut, locatorSize,
        bankLocatorOut, bankLocatorSize, formFactorOut, formFactorSize,
        memoryTypeOut, memoryTypeSize, capacityBytesOut, speedMTsOut,
        configuredSpeedMTsOut, dataWidthOut, totalWidthOut, rankOut, eccOut);
}

int si_get_memory_module_from_table(
    const unsigned char* table,
    int tableSize,
    int index,
    char* manufacturerOut, int manufacturerSize,
    char* partNumberOut, int partNumberSize,
    char* serialNumberOut, int serialNumberSize,
    char* locatorOut, int locatorSize,
    char* bankLocatorOut, int bankLocatorSize,
    char* formFactorOut, int formFactorSize,
    char* memoryTypeOut, int memoryTypeSize,
    long long* capacityBytesOut,
    long long* speedMTsOut,
    long long* configuredSpeedMTsOut,
    int* dataWidthOut,
    int* totalWidthOut,
    int* rankOut,
    int* eccOut) {

    // A null/empty table must NOT fall through to the live platform table:
    // this entry point is "parse exactly what I gave you".
    const bool usable = table && tableSize > 0;

    return si_memory_module_impl(
        usable ? table : reinterpret_cast<const unsigned char*>(""),
        usable ? static_cast<size_t>(tableSize) : 0,
        index,
        manufacturerOut, manufacturerSize, partNumberOut, partNumberSize,
        serialNumberOut, serialNumberSize, locatorOut, locatorSize,
        bankLocatorOut, bankLocatorSize, formFactorOut, formFactorSize,
        memoryTypeOut, memoryTypeSize, capacityBytesOut, speedMTsOut,
        configuredSpeedMTsOut, dataWidthOut, totalWidthOut, rankOut, eccOut);
}

int si_get_memory_hardware_summary(
    long long* installedBytesOut,
    int* moduleCountOut,
    int* slotCountOut,
    long long* maxCapacityBytesOut,
    long long* maxModuleCapacityBytesOut) {

    return si_memory_hardware_summary_impl(
        nullptr, 0,
        installedBytesOut, moduleCountOut, slotCountOut,
        maxCapacityBytesOut, maxModuleCapacityBytesOut);
}

int si_get_memory_hardware_summary_from_table(
    const unsigned char* table,
    int tableSize,
    long long* installedBytesOut,
    int* moduleCountOut,
    int* slotCountOut,
    long long* maxCapacityBytesOut,
    long long* maxModuleCapacityBytesOut) {

    const bool usable = table && tableSize > 0;

    return si_memory_hardware_summary_impl(
        usable ? table : reinterpret_cast<const unsigned char*>(""),
        usable ? static_cast<size_t>(tableSize) : 0,
        installedBytesOut, moduleCountOut, slotCountOut,
        maxCapacityBytesOut, maxModuleCapacityBytesOut);
}

// ---------------------------------------------------------------------
// Why physical memory details are (not) available
// ---------------------------------------------------------------------

int si_get_memory_hardware_status() {

    try {

        std::vector<unsigned char> table;

        int reason = SI_DMI_INVALID;

        if (si_dmi_load_table_ex(
                table,
                reason)) {
            return SI_DMI_OK;
        }

        return reason;
    }
    catch (...) {
        return SI_DMI_INVALID;
    }
}
