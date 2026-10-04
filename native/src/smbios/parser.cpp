// SMBIOS Type 16 + Type 17 parser.
#include "smbios.h"

#include <cctype>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

// =====================================================================
// SMBIOS Type 16 + Type 17 parser
// =====================================================================

// `data`/`size` is a caller-supplied SMBIOS structure table (tests, or a
// provider that already holds one). With data == nullptr the table is
// loaded from the platform instead.
bool si_dmi_read_memory_devices(
    const unsigned char* data,
    size_t size,
    std::vector<SiDmiMemoryArray>& arrays,
    std::vector<SiDmiMemoryModule>& modules) {

    arrays.clear();
    modules.clear();

    std::vector<unsigned char> table;

    if (data) {
        if (size == 0 ||
            size > 16u * 1024u * 1024u) {
            return false;
        }

        table.assign(data, data + size);
    }
    else if (!si_dmi_load_table(table)) {
        return false;
    }

    size_t position = 0;

    while (position + 4 <= table.size()) {

        const unsigned char* record =
            table.data() + position;

        const unsigned char type =
            record[0];

        const unsigned char length =
            record[1];

        const size_t remaining =
            table.size() - position;

        const size_t recordSize =
            si_dmi_record_size(
                record,
                remaining
            );

        if (recordSize == 0)
            break;

        if (length < 4 ||
            static_cast<size_t>(length) >
                recordSize) {
            break;
        }

        // SMBIOS Type 127 = End Of Table.
        if (type == 127)
            break;

        // =============================================================
        // Type 16: Physical Memory Array
        // =============================================================
        //
        // 0x04 Location
        // 0x05 Use
        // 0x06 Error Correction
        // 0x07 Maximum Capacity
        // 0x0B Error Information Handle
        // 0x0D Number Of Memory Devices
        //
        // If Maximum Capacity == 0x80000000, the extended 64-bit
        // capacity is stored at 0x0F and is expressed in bytes.
        //

        if (type == 16 &&
            length >= 0x0F) {

            SiDmiMemoryArray array;

            array.handle =
                si_dmi_u16(
                    record + 0x02
                );

            array.errorCorrection =
                static_cast<int>(
                    record[0x06]
                );

            const unsigned int
                maxCapacityKB =
                    si_dmi_u32(
                        record + 0x07
                    );

            if (maxCapacityKB ==
                0x80000000U) {

                if (length >= 0x17) {

                    const unsigned long long
                        extended =
                            si_dmi_u64(
                                record + 0x0F
                            );

                    if (extended > 0 &&
                        extended <=
                            static_cast<
                                unsigned long long>(
                                LLONG_MAX)) {

                        array.maxCapacityBytes =
                            static_cast<long long>(
                                extended
                            );
                    }
                }
            }
            else if (maxCapacityKB != 0 &&
                     maxCapacityKB !=
                         0xFFFFFFFFU) {

                const unsigned long long
                    bytes =
                        static_cast<
                            unsigned long long>(
                            maxCapacityKB
                        ) * 1024ULL;

                if (bytes <=
                    static_cast<
                        unsigned long long>(
                        LLONG_MAX)) {

                    array.maxCapacityBytes =
                        static_cast<long long>(
                            bytes
                        );
                }
            }

            const unsigned short
                slotCount =
                    si_dmi_u16(
                        record + 0x0D
                    );

            if (slotCount != 0 &&
                slotCount != 0xFFFF) {

                array.slotCount =
                    static_cast<int>(
                        slotCount
                    );
            }

            arrays.push_back(
                std::move(array)
            );
        }

        // =============================================================
        // Type 17: Memory Device
        // =============================================================
        //
        // 0x04 Physical Memory Array Handle
        // 0x08 Total Width
        // 0x0A Data Width
        // 0x0C Size
        // 0x0E Form Factor
        // 0x10 Device Locator
        // 0x11 Bank Locator
        // 0x12 Memory Type
        // 0x15 Speed
        // 0x17 Manufacturer
        // 0x18 Serial Number
        // 0x1A Part Number
        // 0x1B Attributes / Rank
        // 0x1C Extended Size
        // 0x20 Configured Memory Speed
        //

        if (type == 17 &&
            length >= 0x1B) {

            SiDmiMemoryModule module;

            module.arrayHandle =
                si_dmi_u16(
                    record + 0x04
                );

            const unsigned short
                sizeField =
                    si_dmi_u16(
                        record + 0x0C
                    );

            unsigned int extendedSize = 0;

            if (length >= 0x20) {

                extendedSize =
                    si_dmi_u32(
                        record + 0x1C
                    );
            }

            module.capacityBytes =
                si_dmi_size_to_bytes(
                    sizeField,
                    extendedSize
                );

            // Size == 0 means this is an empty slot.
            if (module.capacityBytes == 0) {

                position += recordSize;

                continue;
            }

            // ---------------------------------------------------------
            // Width
            // ---------------------------------------------------------

            const unsigned short
                totalWidth =
                    si_dmi_u16(
                        record + 0x08
                    );

            const unsigned short
                dataWidth =
                    si_dmi_u16(
                        record + 0x0A
                    );

            if (totalWidth != 0 &&
                totalWidth != 0xFFFF) {

                module.totalWidth =
                    static_cast<int>(
                        totalWidth
                    );
            }

            if (dataWidth != 0 &&
                dataWidth != 0xFFFF) {

                module.dataWidth =
                    static_cast<int>(
                        dataWidth
                    );
            }

            // ---------------------------------------------------------
            // Form factor / memory type
            // ---------------------------------------------------------

            module.formFactor =
                static_cast<int>(
                    record[0x0E]
                );

    module.memoryType =
    static_cast<int>(
        record[0x12]
    );


            // ---------------------------------------------------------
            // Speed
            // ---------------------------------------------------------

            if (length >= 0x17) {

                const unsigned short
                    speed =
                        si_dmi_u16(
                            record + 0x15
                        );

                if (speed != 0 &&
                    speed != 0xFFFF) {

                    module.speedMTs =
                        static_cast<long long>(
                            speed
                        );
                }
            }

            // ---------------------------------------------------------
            // Strings
            // ---------------------------------------------------------

            module.locator =
                si_dmi_string(
                    record,
                    recordSize,
                    record[0x10]
                );

            module.bankLocator =
                si_dmi_string(
                    record,
                    recordSize,
                    record[0x11]
                );

            module.manufacturer =
                si_dmi_string(
                    record,
                    recordSize,
                    record[0x17]
                );

            module.serialNumber =
                si_dmi_string(
                    record,
                    recordSize,
                    record[0x18]
                );

            module.partNumber =
                si_dmi_string(
                    record,
                    recordSize,
                    record[0x1A]
                );

            // ---------------------------------------------------------
            // Rank
            // ---------------------------------------------------------
            //
            // SMBIOS Type 17 Attributes:
            //
            //   bits 7-4 = reserved
            //   bits 3-0 = rank
            //
            // Rank 0 means unknown.
            //

            if (length >= 0x1C) {

                const unsigned char
                    attributes =
                        record[0x1B];

                const unsigned int
                    rank =
                        static_cast<unsigned int>(
                            attributes & 0x0F
                        );

                module.rank =
                    rank == 0
                        ? -1
                        : static_cast<int>(
                            rank
                        );
            }

            // ---------------------------------------------------------
            // Configured memory speed
            // ---------------------------------------------------------

            if (length >= 0x22) {

                const unsigned short
                    configuredSpeed =
                        si_dmi_u16(
                            record + 0x20
                        );

                if (configuredSpeed != 0 &&
                    configuredSpeed != 0xFFFF) {

                    module.configuredSpeedMTs =
                        static_cast<long long>(
                            configuredSpeed
                        );
                }
            }

            modules.push_back(
                std::move(module)
            );
        }

        position += recordSize;
    }

    return !arrays.empty() ||
           !modules.empty();
}

// =====================================================================
// Find installed module
// =====================================================================

bool si_dmi_get_memory_module(
    const unsigned char* data,
    size_t size,
    int index,
    std::vector<SiDmiMemoryArray>& arrays,
    std::vector<SiDmiMemoryModule>& modules) {

    if (index < 0)
        return false;

    if (!si_dmi_read_memory_devices(
            data,
            size,
            arrays,
            modules)) {
        return false;
    }

    return index <
        static_cast<int>(
            modules.size()
        );
}
