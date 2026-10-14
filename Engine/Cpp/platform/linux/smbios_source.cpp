// Linux: the SMBIOS table comes from /sys/firmware/dmi/tables/DMI (root) or the saved memory-only snapshot.
#include "../../src/smbios/smbios.h"

#include "sysfs.h"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

// Reads a whole file, reporting errno when it cannot be opened.
bool si_read_whole_file(
    const char* path,
    std::vector<unsigned char>& data,
    int& err) {

    data.clear();

    err = 0;

    FILE* file =
        std::fopen(path, "rb");

    if (!file) {
        err = errno;
        return false;
    }

    unsigned char chunk[4096];

    bool ok = true;

    for (;;) {

        const size_t got =
            std::fread(chunk, 1, sizeof(chunk), file);

        if (got > 0)
            data.insert(data.end(), chunk, chunk + got);

        // Defensive upper bound.
        if (data.size() > 16u * 1024u * 1024u) {
            ok = false;
            break;
        }

        if (got < sizeof(chunk)) {

            if (std::ferror(file))
                ok = false;

            break;
        }
    }

    std::fclose(file);

    if (!ok) {
        data.clear();
        err = EIO;
    }

    return ok;
}

std::string si_current_boot_id() {

    std::vector<unsigned char> raw;

    int err = 0;

    if (!si_read_whole_file(
            "/proc/sys/kernel/random/boot_id",
            raw,
            err)) {
        return std::string();
    }

    std::string id(raw.begin(), raw.end());

    while (!id.empty() &&
           (id.back() == '\n' ||
            id.back() == '\r' ||
            id.back() == ' ')) {
        id.pop_back();
    }

    return id;
}

// Where the root helper saves the memory snapshot. SYSTEMINFO_SMBIOS_SNAPSHOT
// overrides it (used by tests and unusual installs).
std::string si_snapshot_path() {

    const char* override_path =
        std::getenv("SYSTEMINFO_SMBIOS_SNAPSHOT");

    if (override_path &&
        override_path[0] != '\0') {
        return std::string(override_path);
    }

    return std::string("/var/lib/system-info/smbios-memory.bin");
}


// Linux: the live firmware table first (works as root, or where the system
// grants read access); otherwise the memory-only snapshot saved by the root
// helper. `reason` says why nothing could be loaded.
bool si_dmi_load_table_ex(
    std::vector<unsigned char>& table,
    int& reason) {

    table.clear();

    int liveError = 0;

    std::vector<unsigned char> raw;

    if (si_read_whole_file(
            SI_LIVE_DMI_TABLE,
            raw,
            liveError)) {

        if (raw.empty()) {
            reason = SI_DMI_INVALID;
            return false;
        }

        table.swap(raw);

        reason = SI_DMI_OK;

        return true;
    }

    std::vector<unsigned char> snapshot;

    int snapshotError = 0;

    if (si_read_whole_file(
            si_snapshot_path().c_str(),
            snapshot,
            snapshotError)) {

        const int status =
            si_snapshot_decode(
                snapshot.data(),
                snapshot.size(),
                si_current_boot_id(),
                table
            );

        if (status == SI_SNAP_OK) {
            reason = SI_DMI_OK;
            return true;
        }

        reason =
            status == SI_SNAP_STALE
                ? SI_DMI_STALE_SNAPSHOT
                : SI_DMI_INVALID;

        return false;
    }

    // No snapshot either: report why the live table was not readable.
    reason =
        si_dmi_open_failure_reason(
            liveError
        );

    return false;
}
