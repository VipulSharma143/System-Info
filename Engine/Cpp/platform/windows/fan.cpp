// Windows fan sensors.
#include "../../src/internal.h"

#include <windows.h>
#include <psapi.h>

// ---------------------------------------------------------------------
// Fan
// ---------------------------------------------------------------------

// Windows has no vendor-neutral fan RPM API.
// OEM WMI interfaces or kernel drivers are required on some machines.
// Do not report a fabricated zero.

int si_get_fan(
    int,
    char*,
    int,
    int*) {

    return 0;
}
