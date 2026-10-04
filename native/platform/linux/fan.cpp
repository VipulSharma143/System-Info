// Linux fan sensors (hwmon).
#include "../../src/internal.h"
#include "sysfs.h"

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <set>
#include <sstream>
#include <sys/statvfs.h>
#include <unistd.h>
#include <vector>

// =====================================================================
// Fans
// =====================================================================

int si_get_fan(
    int index,
    char* labelOut,
    int labelSize,
    int* rpmOut) {

    if (index < 0)
        return 0;

    try {
        int seen = 0;

        for (const auto& hw :
             sorted_children(
                 "/sys/class/hwmon")) {

            const std::string chip =
                read_line(
                    hw + "/name"
                );

            for (const auto& file :
                 sorted_children(hw)) {

                const std::string base =
                    fs::path(file)
                        .filename()
                        .string();

                if (base.size() < 10 ||
                    base.compare(
                        0,
                        3,
                        "fan") != 0 ||
                    base.compare(
                        base.size() - 6,
                        6,
                        "_input") != 0) {
                    continue;
                }

                long long rpm = -1;

                if (!read_int(
                        file,
                        rpm) ||
                    rpm < 0) {
                    continue;
                }

                if (seen++ != index)
                    continue;

                const std::string stem =
                    file.substr(
                        0,
                        file.size() - 6
                    );

                std::string label =
                    read_line(
                        stem + "_label"
                    );

                if (label.empty()) {

                    label =
                        chip.empty()
                            ? std::string("hwmon")
                            : chip;

                    label += " ";
                    label +=
                        base.substr(
                            0,
                            base.size() - 6
                        );
                }

                copy_out(
                    labelOut,
                    labelSize,
                    label
                );

                if (rpmOut)
                    *rpmOut =
                        static_cast<int>(
                            rpm
                        );

                return 1;
            }
        }
    }
    catch (...) {
    }

    return 0;
}
