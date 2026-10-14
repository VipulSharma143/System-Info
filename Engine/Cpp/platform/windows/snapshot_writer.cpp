// Windows reads the firmware table unprivileged, so no snapshot is ever written.
#include "../../src/internal.h"

int si_write_memory_smbios_snapshot(
    const char* path) {

    (void)path;

    // Windows reads the firmware table without elevation; no snapshot needed.
    return -5;
}
