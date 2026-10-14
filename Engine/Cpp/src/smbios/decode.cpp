// SMBIOS Type 17 size conversion and display mappings (form factor, memory type, ECC).
#include "smbios.h"

#include <cctype>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

// =====================================================================
// Type 17 memory-size conversion
// =====================================================================
//
// Type 17 Size:
//
//   0x0000      = empty
//   0xFFFF      = unknown
//   0x7FFF      = use Extended Size
//   bit 15 = 0  = MiB
//   bit 15 = 1  = KiB
//

long long si_dmi_size_to_bytes(
    unsigned short sizeField,
    unsigned int extendedSizeField) {

    if (sizeField == 0)
        return 0;

    if (sizeField == 0xFFFF)
        return -1;

    if (sizeField == 0x7FFF) {

        if (extendedSizeField == 0)
            return -1;

        const unsigned long long bytes =
            static_cast<unsigned long long>(
                extendedSizeField
            ) *
            1024ULL *
            1024ULL;

        if (bytes >
            static_cast<unsigned long long>(
                LLONG_MAX)) {
            return -1;
        }

        return static_cast<long long>(
            bytes
        );
    }

    const unsigned long long raw =
        static_cast<unsigned long long>(
            sizeField & 0x7FFF
        );

    if (raw == 0)
        return 0;

    unsigned long long bytes = 0;

    if (sizeField & 0x8000) {

        // KiB
        bytes =
            raw * 1024ULL;
    }
    else {

        // MiB
        bytes =
            raw *
            1024ULL *
            1024ULL;
    }

    if (bytes >
        static_cast<unsigned long long>(
            LLONG_MAX)) {
        return -1;
    }

    return static_cast<long long>(
        bytes
    );
}

// =====================================================================
// SMBIOS display mappings
// =====================================================================

std::string si_memory_form_factor(
    int value) {

    switch (value) {
        case 1:  return "Other";
        case 2:  return "Unknown";
        case 3:  return "SIMM";
        case 4:  return "SIP";
        case 5:  return "Chip";
        case 6:  return "DIP";
        case 7:  return "ZIP";
        case 8:  return "Proprietary Card";
        case 9:  return "DIMM";
        case 10: return "TSOP";
        case 11: return "Row of chips";
        case 12: return "RIMM";
        case 13: return "SODIMM";
        case 14: return "SRIMM";
        case 15: return "FB-DIMM";
        default: return {};
    }
}

std::string si_memory_type(int value) {
    switch (value) {
        case 0x01: return "Other";
        case 0x02: return "Unknown";
        case 0x03: return "DRAM";
        case 0x04: return "EDRAM";
        case 0x05: return "VRAM";
        case 0x06: return "SRAM";
        case 0x07: return "RAM";
        case 0x08: return "ROM";
        case 0x09: return "Flash";
        case 0x0A: return "EEPROM";
        case 0x0B: return "FEPROM";
        case 0x0C: return "EPROM";
        case 0x0D: return "CDRAM";
        case 0x0E: return "3DRAM";
        case 0x0F: return "SDRAM";
        case 0x10: return "SGRAM";
        case 0x11: return "RDRAM";
        case 0x12: return "DDR";
        case 0x13: return "DDR2";
        case 0x14: return "DDR2 FB-DIMM";
        case 0x18: return "DDR3";
        case 0x19: return "FBD2";
        case 0x1A: return "DDR4";
        case 0x1B: return "LPDDR";
        case 0x1C: return "LPDDR2";
        case 0x1D: return "LPDDR3";
        case 0x1E: return "LPDDR4";
        case 0x1F: return "Logical non-volatile device";
        case 0x20: return "HBM";
        case 0x21: return "HBM2";
        case 0x22: return "DDR5";
        case 0x23: return "LPDDR5";
        case 0x24: return "HBM3";
        default:   return {};
    }
}

// =====================================================================
// SMBIOS ECC mapping
// =====================================================================
//
// Public contract:
//
//   0  = explicitly no ECC
//   1  = ECC / error correction exposed
//  -1  = unknown
//
// Type 16 standard values:
//
//   0x03 = None
//   0x04 = Parity
//   0x05 = Single-bit ECC
//   0x06 = Multi-bit ECC
//   0x07 = CRC
//
// Do not invent meanings for unsupported/reserved values.

int si_dmi_ecc_value(
    int errorCorrection) {

    switch (errorCorrection) {

        case 0x03:
            return 0;

        case 0x05:
        case 0x06:
            return 1;

        default:
            return -1;
    }
}
