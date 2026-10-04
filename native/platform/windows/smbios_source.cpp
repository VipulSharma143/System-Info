// Windows: the SMBIOS table comes from GetSystemFirmwareTable (no elevation needed).
#include "../../src/smbios/smbios.h"

#include <windows.h>

// Windows: GetSystemFirmwareTable('RSMB'). No admin rights needed, and no
// wmic / PowerShell subprocess.
bool si_dmi_load_table_ex(
    std::vector<unsigned char>& table,
    int& reason) {

    table.clear();

    reason = SI_DMI_NOT_PRESENT;

    const DWORD signature =
        (static_cast<DWORD>('R') << 24) |
        (static_cast<DWORD>('S') << 16) |
        (static_cast<DWORD>('M') << 8) |
        static_cast<DWORD>('B');

    const UINT size =
        GetSystemFirmwareTable(
            signature,
            0,
            nullptr,
            0
        );

    if (size == 0)
        return false;

    reason = SI_DMI_INVALID;

    // Header is 8 bytes; also a defensive upper bound.
    if (size <= 8 ||
        size > 16u * 1024u * 1024u) {
        return false;
    }

    std::vector<unsigned char> raw(size);

    const UINT got =
        GetSystemFirmwareTable(
            signature,
            0,
            raw.data(),
            size
        );

    if (got <= 8 ||
        got > size) {
        return false;
    }

    if (!si_dmi_extract_rsmb(
            raw.data(),
            got,
            table)) {
        return false;
    }

    reason = SI_DMI_OK;

    return true;
}
