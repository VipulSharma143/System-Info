// si_smbios_snapshot — root helper that makes physical RAM details available
// to the unprivileged System Info app on Linux.
//
// Linux only lets root read /sys/firmware/dmi/tables/DMI (it also holds the
// machine's serial number and UUID). This helper reads it and saves ONLY the
// memory records (SMBIOS Type 16/17) to a world-readable file; the app reads
// that file instead. Nothing else from the table is copied.
//
//   sudo si_smbios_snapshot            # default location
//   sudo si_smbios_snapshot <path>     # custom location
//
// Run it once, or install the startup service (see
// packaging/linux/install-smbios-snapshot.sh) so it refreshes every boot.

#include "../include/native_engine.h"

#include <cstdio>

int main(int argc, char** argv) {

    const char* path = (argc > 1) ? argv[1] : nullptr;

    const int result = si_write_memory_smbios_snapshot(path);

    switch (result) {

        case 1:
            std::printf(
                "Memory snapshot saved%s%s.\n",
                path ? " to " : "",
                path ? path : "");
            return 0;

        case -1:
            std::fprintf(
                stderr,
                "Not allowed to read the firmware table. Run this with administrator rights, e.g. sudo %s\n",
                argv[0]);
            return 2;

        case -2:
            std::fprintf(
                stderr,
                "This system has no firmware memory table (common in virtual machines), so there is nothing to save.\n");
            return 3;

        case -3:
            std::fprintf(
                stderr,
                "The firmware table contains no memory module records.\n");
            return 4;

        case -4:
            std::fprintf(
                stderr,
                "Could not write the snapshot file. Check that the destination folder is writable.\n");
            return 5;

        default:
            std::fprintf(
                stderr,
                "Memory snapshots are not supported on this platform.\n");
            return 6;
    }
}
