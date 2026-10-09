// overlay_platform.h — the per-OS factories; implemented in platform/linux/overlay_sources.cpp and
// platform/windows/overlay_sources.cpp. `root` is "" in production; tests point it at a fake /proc + /sys tree.
#pragma once
#include <memory>
#include <string>
#include "overlay_types.h"

namespace si {
std::unique_ptr<CpuSource> makeCpuSource(const std::string& root);
std::unique_ptr<GpuSource> makeGpuSource(const std::string& root);
}
