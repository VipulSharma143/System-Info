// Windows storage volumes.
#include "../../src/internal.h"

#include <windows.h>
#include <psapi.h>

#include <vector>

// ---------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------

int si_get_storage_volume(
    int index,
    char* mountOut,
    int mountSize,
    char* fsOut,
    int fsSize,
    long long* totalBytes,
    long long* freeBytes) {

    if (index < 0)
        return 0;

    try {
        const DWORD mask =
            GetLogicalDrives();

        int seen = 0;

        for (int i = 0; i < 26; ++i) {

            if (!(mask & (1u << i)))
                continue;

            char root[4] = {
                static_cast<char>('A' + i),
                ':',
                '\\',
                '\0'
            };

            const UINT type =
                GetDriveTypeA(root);

            if (type != DRIVE_FIXED &&
                type != DRIVE_REMOVABLE) {
                continue;
            }

            ULARGE_INTEGER available{};
            ULARGE_INTEGER total{};
            ULARGE_INTEGER freeAll{};

            if (!GetDiskFreeSpaceExA(
                    root,
                    &available,
                    &total,
                    &freeAll)) {
                continue;
            }

            if (seen++ != index)
                continue;

            char fsName[64] = {};

            GetVolumeInformationA(
                root,
                nullptr,
                0,
                nullptr,
                nullptr,
                nullptr,
                fsName,
                sizeof(fsName)
            );

            copy_out(
                mountOut,
                mountSize,
                root
            );

            copy_out(
                fsOut,
                fsSize,
                fsName
            );

            if (totalBytes)
                *totalBytes =
                    static_cast<long long>(
                        total.QuadPart
                    );

            if (freeBytes)
                *freeBytes =
                    static_cast<long long>(
                        available.QuadPart
                    );

            return 1;
        }
    }
    catch (...) {
    }

    return 0;
}
