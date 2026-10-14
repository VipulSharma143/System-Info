// SMBIOS primitive readers, string resolver and record sizing.
#include "smbios.h"

#include <cctype>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

// =====================================================================
// SMBIOS primitive readers
// =====================================================================

unsigned short si_dmi_u16(
    const unsigned char* p) {

    if (!p)
        return 0;

    return static_cast<unsigned short>(
        static_cast<unsigned short>(p[0]) |
        static_cast<unsigned short>(
            static_cast<unsigned short>(p[1])
            << 8
        )
    );
}

unsigned int si_dmi_u32(
    const unsigned char* p) {

    if (!p)
        return 0;

    return
        static_cast<unsigned int>(p[0]) |
        (static_cast<unsigned int>(p[1]) << 8) |
        (static_cast<unsigned int>(p[2]) << 16) |
        (static_cast<unsigned int>(p[3]) << 24);
}

unsigned long long si_dmi_u64(
    const unsigned char* p) {

    if (!p)
        return 0;

    return
        static_cast<unsigned long long>(p[0]) |
        (static_cast<unsigned long long>(p[1]) << 8) |
        (static_cast<unsigned long long>(p[2]) << 16) |
        (static_cast<unsigned long long>(p[3]) << 24) |
        (static_cast<unsigned long long>(p[4]) << 32) |
        (static_cast<unsigned long long>(p[5]) << 40) |
        (static_cast<unsigned long long>(p[6]) << 48) |
        (static_cast<unsigned long long>(p[7]) << 56);
}

// =====================================================================
// SMBIOS string resolver
// =====================================================================

std::string si_dmi_string(
    const unsigned char* record,
    size_t recordSize,
    unsigned char stringIndex) {

    if (!record ||
        recordSize < 4 ||
        stringIndex == 0) {
        return {};
    }

    const size_t formattedLength =
        static_cast<size_t>(
            record[1]
        );

    if (formattedLength < 4 ||
        formattedLength >= recordSize) {
        return {};
    }

    size_t position =
        formattedLength;

    unsigned int currentIndex = 1;

    while (position < recordSize) {

        if (record[position] == '\0') {

            if (position + 1 < recordSize &&
                record[position + 1] == '\0') {
                break;
            }

            ++position;
            ++currentIndex;
            continue;
        }

        const size_t start =
            position;

        while (position < recordSize &&
               record[position] != '\0') {

            ++position;
        }

        if (currentIndex ==
            static_cast<unsigned int>(
                stringIndex)) {

            return std::string(
                reinterpret_cast<const char*>(
                    record + start
                ),
                position - start
            );
        }

        if (position >= recordSize)
            break;

        ++position;
        ++currentIndex;
    }

    return {};
}

// =====================================================================
// SMBIOS record size
// =====================================================================

size_t si_dmi_record_size(
    const unsigned char* record,
    size_t remaining) {

    if (!record ||
        remaining < 4) {
        return 0;
    }

    const size_t formattedLength =
        static_cast<size_t>(
            record[1]
        );

    if (formattedLength < 4 ||
        formattedLength > remaining) {
        return 0;
    }

    size_t position =
        formattedLength;

    while (position + 1 < remaining) {

        if (record[position] == '\0' &&
            record[position + 1] == '\0') {

            return position + 2;
        }

        ++position;
    }

    return 0;
}
