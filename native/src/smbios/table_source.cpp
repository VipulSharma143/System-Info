// Platform-neutral half of getting the SMBIOS table: failure reasons, the Windows RawSMBIOSData
// header, and the memory-only snapshot format. The platform-specific loaders are in platform/<os>/.
#include "smbios.h"

#include <cctype>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

// =====================================================================
// SMBIOS structure-table source (the only platform-specific part)
// =====================================================================
//
// Both loaders produce the same thing: the raw SMBIOS *structure table*
// (a run of Type N records), with no container header. Everything after
// this point is platform independent and is exercised by
// tests/native/smbios_parse_test.cpp using hand-built tables.

// Why the firmware table could not be loaded. Surfaced to the backend through
// si_get_memory_hardware_status() so the UI can say what to do about it,
// instead of one vague "unavailable" for four different situations.

// open()/fopen() errno -> reason.
int si_dmi_open_failure_reason(int err) {

    switch (err) {
        case EACCES:
        case EPERM:
            return SI_DMI_PERMISSION;

        case ENOENT:
        case ENOTDIR:
            return SI_DMI_NOT_PRESENT;

        default:
            return SI_DMI_INVALID;
    }
}

// Windows hands back a RawSMBIOSData container, not the bare table:
//
//   BYTE  Used20CallingMethod
//   BYTE  SMBIOSMajorVersion
//   BYTE  SMBIOSMinorVersion
//   BYTE  DmiRevision
//   DWORD Length                  <- number of table bytes that follow
//   BYTE  SMBIOSTableData[Length]
//
// This strips that 8-byte header. It is platform independent (and compiled
// everywhere) so it can be tested with hand-built buffers on any host.
// The header's Length is never trusted over the bytes actually received.
bool si_dmi_extract_rsmb(
    const unsigned char* raw,
    size_t rawSize,
    std::vector<unsigned char>& table) {

    table.clear();

    if (!raw ||
        rawSize <= 8) {
        return false;
    }

    size_t tableLength =
        static_cast<size_t>(
            si_dmi_u32(
                raw + 4
            )
        );

    if (tableLength > rawSize - 8)
        tableLength = rawSize - 8;

    if (tableLength < 4)
        return false;

    table.assign(
        raw + 8,
        raw + 8 + tableLength
    );

    return true;
}

// =====================================================================
// Memory-only SMBIOS snapshot (Linux, for unprivileged use)
// =====================================================================
//
// Linux only lets root read the firmware table, because it also carries the
// machine's serial number and UUID. A small root helper therefore saves just
// the memory records (Type 16 + Type 17 + the end marker) to a world-readable
// file, and the unprivileged app reads that instead. Nothing else from the
// firmware table is ever copied.
//
// File layout (64-byte header, then the filtered structure table):
//
//   0..15   magic "SI-SMBIOS-MEM-01"
//   16..55  boot id of the boot that produced it (NUL padded)
//   56..59  table length, little endian
//   60..63  reserved (zero)
//
// The boot id lets the reader refuse a snapshot taken before the last
// restart (RAM can only be swapped across a power cycle), so an old file can
// never silently show modules that are no longer installed.
//
// The helpers below are pure (no I/O) so they are unit-tested on every host.



// Keeps only Type 16, Type 17 and the end marker, byte for byte (string sets
// included). Returns false when the table has no memory records at all.
bool si_dmi_filter_memory_records(
    const unsigned char* data,
    size_t size,
    std::vector<unsigned char>& out) {

    out.clear();

    if (!data ||
        size == 0) {
        return false;
    }

    bool haveMemory = false;

    size_t offset = 0;

    while (offset + 4 <= size) {

        const unsigned char type =
            data[offset];

        const size_t recordSize =
            si_dmi_record_size(
                data + offset,
                size - offset
            );

        if (recordSize == 0)
            break;

        if (type == 127)
            break;

        if (type == 16 ||
            type == 17) {

            out.insert(
                out.end(),
                data + offset,
                data + offset + recordSize
            );

            haveMemory = true;
        }

        offset += recordSize;
    }

    if (!haveMemory) {
        out.clear();
        return false;
    }

    // Terminate the table the way firmware does.
    static const unsigned char endRecord[] = {
        127, 4, 0xFF, 0xFF, 0, 0
    };

    out.insert(
        out.end(),
        endRecord,
        endRecord + sizeof(endRecord)
    );

    return true;
}

void si_snapshot_encode(
    const std::string& bootId,
    const std::vector<unsigned char>& table,
    std::vector<unsigned char>& out) {

    out.assign(SI_SNAP_HEADER, 0);

    std::memcpy(
        out.data(),
        SI_SNAP_MAGIC,
        sizeof(SI_SNAP_MAGIC)
    );

    const size_t idLength =
        bootId.size() < SI_SNAP_BOOTID - 1
            ? bootId.size()
            : SI_SNAP_BOOTID - 1;

    std::memcpy(
        out.data() + 16,
        bootId.data(),
        idLength
    );

    const unsigned int length =
        static_cast<unsigned int>(table.size());

    for (int i = 0; i < 4; ++i) {
        out[56 + i] =
            static_cast<unsigned char>(
                (length >> (8 * i)) & 0xFF
            );
    }

    out.insert(
        out.end(),
        table.begin(),
        table.end()
    );
}

// `currentBootId` empty = the running boot id is unknown, so staleness cannot
// be judged and the snapshot is accepted.
int si_snapshot_decode(
    const unsigned char* data,
    size_t size,
    const std::string& currentBootId,
    std::vector<unsigned char>& table) {

    table.clear();

    if (!data ||
        size < SI_SNAP_HEADER ||
        std::memcmp(
            data,
            SI_SNAP_MAGIC,
            sizeof(SI_SNAP_MAGIC)) != 0) {
        return SI_SNAP_INVALID;
    }

    const size_t length =
        static_cast<size_t>(
            si_dmi_u32(
                data + 56
            )
        );

    if (length < 4 ||
        length > size - SI_SNAP_HEADER) {
        return SI_SNAP_INVALID;
    }

    std::string snapshotBootId;

    for (size_t i = 0; i < SI_SNAP_BOOTID; ++i) {

        const char c =
            static_cast<char>(
                data[16 + i]
            );

        if (c == '\0')
            break;

        snapshotBootId.push_back(c);
    }

    if (!currentBootId.empty() &&
        snapshotBootId != currentBootId) {
        return SI_SNAP_STALE;
    }

    table.assign(
        data + SI_SNAP_HEADER,
        data + SI_SNAP_HEADER + length
    );

    return SI_SNAP_OK;
}

bool si_dmi_load_table(
    std::vector<unsigned char>& table) {

    int reason = SI_DMI_INVALID;

    return si_dmi_load_table_ex(
        table,
        reason
    );
}
