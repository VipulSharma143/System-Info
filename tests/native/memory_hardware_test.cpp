#include "../../native/include/native_engine.h"

#include <cstdio>
#include <cstring>

static void print_string(const char* name, const char* value)
{
    std::printf("%-22s %s\n", name, value[0] ? value : "Unknown");
}

static void print_bytes(const char* name, long long bytes)
{
    if (bytes < 0) {
        std::printf("%-22s Unknown\n", name);
        return;
    }

    std::printf(
        "%-22s %lld bytes (%.2f GiB)\n",
        name,
        bytes,
        static_cast<double>(bytes) / (1024.0 * 1024.0 * 1024.0)
    );
}

int main()
{
    long long installedBytes = -1;
    int moduleCount = -1;
    int slotCount = -1;
    long long maxCapacityBytes = -1;
    long long maxModuleCapacityBytes = -1;

    std::printf("========== MEMORY HARDWARE ==========\n\n");

    const int summaryOk = si_get_memory_hardware_summary(
        &installedBytes,
        &moduleCount,
        &slotCount,
        &maxCapacityBytes,
        &maxModuleCapacityBytes
    );

    if (!summaryOk) {
        std::printf("Memory hardware information unavailable.\n");
        return 0;
    }

    print_bytes("Installed Memory", installedBytes);

    std::printf("%-22s %d\n", "Module Count", moduleCount);
    std::printf("%-22s %d\n", "Physical Slots", slotCount);

    if (moduleCount >= 0 && slotCount >= 0) {
        std::printf("%-22s %d\n",
                    "Empty Slots",
                    slotCount >= moduleCount ? slotCount - moduleCount : -1);
    }

    print_bytes("Maximum Capacity", maxCapacityBytes);
    print_bytes("Maximum / Module", maxModuleCapacityBytes);

    std::printf("\n========== MEMORY MODULES ==========\n\n");

    for (int i = 0; i < moduleCount; ++i) {
        char manufacturer[256] = {};
        char partNumber[256] = {};
        char serialNumber[256] = {};
        char locator[256] = {};
        char bankLocator[256] = {};
        char formFactor[128] = {};
        char memoryType[128] = {};

        long long capacityBytes = -1;
        long long speedMTs = -1;
        long long configuredSpeedMTs = -1;

        int dataWidth = -1;
        int totalWidth = -1;
        int rank = -1;
        int ecc = -1;

        const int ok = si_get_memory_module(
            i,
            manufacturer,
            sizeof(manufacturer),
            partNumber,
            sizeof(partNumber),
            serialNumber,
            sizeof(serialNumber),
            locator,
            sizeof(locator),
            bankLocator,
            sizeof(bankLocator),
            formFactor,
            sizeof(formFactor),
            memoryType,
            sizeof(memoryType),
            &capacityBytes,
            &speedMTs,
            &configuredSpeedMTs,
            &dataWidth,
            &totalWidth,
            &rank,
            &ecc
        );

        if (!ok) {
            std::printf("MODULE %d: unavailable\n\n", i + 1);
            continue;
        }

        std::printf("MODULE %d\n", i + 1);
        std::printf("------------------------------\n");

        print_string("Locator", locator);
        print_string("Bank Locator", bankLocator);
        print_string("Manufacturer", manufacturer);
        print_string("Part Number", partNumber);
        print_string("Serial Number", serialNumber);
        print_string("Form Factor", formFactor);
        print_string("Memory Type", memoryType);

        print_bytes("Capacity", capacityBytes);

        std::printf("%-22s %lld MT/s\n",
                    "Speed",
                    speedMTs >= 0 ? speedMTs : -1);

        std::printf("%-22s %lld MT/s\n",
                    "Configured Speed",
                    configuredSpeedMTs >= 0 ? configuredSpeedMTs : -1);

        std::printf("%-22s %d bits\n", "Data Width", dataWidth);
        std::printf("%-22s %d bits\n", "Total Width", totalWidth);
        std::printf("%-22s %d\n", "Rank", rank);

        std::printf("%-22s %s\n",
                    "ECC Capability",
                    ecc == 1 ? "Supported" :
                    ecc == 0 ? "Not supported" :
                               "Unknown");

        std::printf("\n");
    }

    return 0;
}
