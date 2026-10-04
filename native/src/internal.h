// internal.h — helpers shared by every native source file (not part of the exported ABI).
#pragma once

#include "../include/native_engine.h"

#include <cstring>
#include <string>

// Copies `src` into a caller-supplied buffer, always NUL-terminating; returns bytes written.
inline int copy_out(char* dst, int size, const std::string& src) {
    if (!dst || size <= 0)
        return 0;

    const size_t capacity = static_cast<size_t>(size - 1);
    const size_t n = src.size() < capacity ? src.size() : capacity;

    if (n > 0)
        std::memcpy(dst, src.data(), n);

    dst[n] = '\0';
    return static_cast<int>(n);
}

// Null out-pointers are valid and mean the caller does not want that value.
inline void si_mem_put(long long* p, long long value) {
    if (p)
        *p = value;
}
