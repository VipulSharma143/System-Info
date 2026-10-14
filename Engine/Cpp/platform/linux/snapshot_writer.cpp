// Linux root helper entry: saves only the memory records of the firmware table for unprivileged use.
#include "../../src/smbios/smbios.h"

#include "sysfs.h"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <system_error>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

// Filters `raw` down to the memory records and writes the snapshot file.
// Split from the public entry point so it can be tested without root and
// without a real firmware table. Return codes as documented in the header.
int si_snapshot_write_from_table(
    const std::vector<unsigned char>& raw,
    const char* path) {

    try {

        std::vector<unsigned char> memory;

        if (!si_dmi_filter_memory_records(
                raw.data(),
                raw.size(),
                memory)) {
            return -3;
        }

        std::vector<unsigned char> file;

        si_snapshot_encode(
            si_current_boot_id(),
            memory,
            file
        );

        const std::string target =
            (path && path[0] != '\0')
                ? std::string(path)
                : si_snapshot_path();

        // Create the folder (0755: everyone may read the snapshot inside).
        const size_t slash =
            target.find_last_of('/');

        if (slash != std::string::npos &&
            slash > 0) {

            const std::string directory =
                target.substr(0, slash);

            std::error_code ec;

            std::filesystem::create_directories(
                directory,
                ec
            );

            std::filesystem::permissions(
                directory,
                std::filesystem::perms::owner_all |
                    std::filesystem::perms::group_read |
                    std::filesystem::perms::group_exec |
                    std::filesystem::perms::others_read |
                    std::filesystem::perms::others_exec,
                ec
            );
        }

        // Write to a temporary file and rename it into place, so a reader
        // never sees a half-written snapshot.
        const std::string temporary =
            target + ".tmp";

        ::unlink(temporary.c_str());

        const int fd =
            ::open(
                temporary.c_str(),
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
                0644
            );

        if (fd < 0)
            return -4;

        size_t written = 0;

        bool ok = true;

        while (written < file.size()) {

            const ssize_t n =
                ::write(
                    fd,
                    file.data() + written,
                    file.size() - written
                );

            if (n <= 0) {
                ok = false;
                break;
            }

            written += static_cast<size_t>(n);
        }

        // umask must not make the snapshot unreadable to the app.
        if (ok &&
            ::fchmod(fd, 0644) != 0) {
            ok = false;
        }

        if (ok &&
            ::fsync(fd) != 0) {
            ok = false;
        }

        ::close(fd);

        if (!ok ||
            ::rename(
                temporary.c_str(),
                target.c_str()) != 0) {

            ::unlink(temporary.c_str());

            return -4;
        }

        return 1;
    }
    catch (...) {
        return -4;
    }
}

int si_write_memory_smbios_snapshot(
    const char* path) {

    try {

        std::vector<unsigned char> raw;

        int err = 0;

        if (!si_read_whole_file(
                SI_LIVE_DMI_TABLE,
                raw,
                err)) {

            const int reason =
                si_dmi_open_failure_reason(err);

            if (reason == SI_DMI_PERMISSION)
                return -1;

            if (reason == SI_DMI_NOT_PRESENT)
                return -2;

            return -3;
        }

        return si_snapshot_write_from_table(
            raw,
            path
        );
    }
    catch (...) {
        return -4;
    }
}
