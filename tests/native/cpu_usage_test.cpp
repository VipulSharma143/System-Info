// Verifies get_cpu_usage_percent no longer sleeps per call: first call may wait one window, later calls must be fast
// and always inside 0..100.
#include "../../native/include/native_engine.h"
#include <chrono>
#include <cstdio>
#include <thread>

using Clock = std::chrono::steady_clock;
static int failures = 0;
static void check(bool ok, const char* what) { std::printf("%s  %s\n", ok ? "ok  " : "FAIL", what); if (!ok) ++failures; }

int main() {
    double v = get_cpu_usage_percent();
    check(v >= 0.0 && v <= 100.0, "first call returns a percentage");

    std::this_thread::sleep_for(std::chrono::milliseconds(250));
    const auto t0 = Clock::now();
    v = get_cpu_usage_percent();
    const double ms = std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
    check(v >= 0.0 && v <= 100.0, "later call returns a percentage");
    check(ms < 50.0, "later call does not sleep");

    const auto t1 = Clock::now();
    for (int i = 0; i < 1000; ++i) v = get_cpu_usage_percent();
    const double burst = std::chrono::duration<double, std::milli>(Clock::now() - t1).count();
    check(v >= 0.0 && v <= 100.0 && burst < 500.0, "rapid calls reuse the last value quickly");
    return failures == 0 ? 0 : 1;
}
