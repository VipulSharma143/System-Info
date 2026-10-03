// Native RAM test. Built with -DBUILD_NATIVE_TESTS=ON, run with ctest.
#include "../../native/include/native_engine.h"
#include <cstdio>

static int failures = 0;
#define CHECK(cond, msg) do { if (!(cond)) { std::printf("FAIL: %s\n", msg); failures++; } } while (0)

int main() {
    long long total, avail, freeB, cached, buffers, swapTotal, swapUsed, commitLimit, commitUsed;
    CHECK(si_get_memory_info(&total, &avail, &freeB, &cached, &buffers,
                             &swapTotal, &swapUsed, &commitLimit, &commitUsed) == 1,
          "memory info available");

    // Required values: real numbers, never -1.
    CHECK(total > 0, "total RAM is positive");
    CHECK(avail >= 0 && avail <= total, "available is within 0..total");

    // Optional values: either explicitly unknown (-1) or plausible.
    CHECK(freeB == -1 || (freeB >= 0 && freeB <= total), "free unknown or within 0..total");
    CHECK(cached == -1 || cached >= 0, "cached unknown or non-negative");
    CHECK(buffers == -1 || buffers >= 0, "buffers unknown or non-negative");
    CHECK(swapTotal == -1 || swapTotal >= 0, "swap total unknown or non-negative");
    CHECK((swapTotal == -1) == (swapUsed == -1), "swap total/used are known together");
    CHECK(swapTotal == -1 || (swapUsed >= 0 && swapUsed <= swapTotal), "swap used within 0..total");
    CHECK((commitLimit == -1) == (commitUsed == -1), "commit limit/used are known together");

#ifdef _WIN32
    CHECK(freeB == -1 && buffers == -1, "free/buffers are Linux-only: must be -1 on Windows");
    CHECK(commitLimit > 0 && commitUsed >= 0, "commit charge is reported on Windows");
#else
    CHECK(commitLimit == -1 && commitUsed == -1, "commit charge is Windows-only: must be -1 on Linux");
    CHECK(freeB >= 0 && buffers >= 0, "free/buffers are reported on Linux");
#endif

    // Null outputs must not crash, and one call must not disturb the next.
    CHECK(si_get_memory_info(nullptr, nullptr, nullptr, nullptr, nullptr,
                             nullptr, nullptr, nullptr, nullptr) == 1, "null outputs tolerated");
    long long total2 = -1;
    CHECK(si_get_memory_info(&total2, nullptr, nullptr, nullptr, nullptr,
                             nullptr, nullptr, nullptr, nullptr) == 1 && total2 == total,
          "total RAM is stable between calls");

    // Human-readable line so you can compare against `free -b` / Task Manager.
    std::printf("total=%lld avail=%lld free=%lld cached=%lld buffers=%lld swap=%lld/%lld commit=%lld/%lld\n",
                total, avail, freeB, cached, buffers, swapUsed, swapTotal, commitUsed, commitLimit);

    if (failures) std::printf("%d check(s) FAILED\n", failures);
    else std::printf("memory info tests passed\n");
    return failures ? 1 : 0;
}