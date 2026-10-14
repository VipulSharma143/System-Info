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

// Escapes `s` for use inside a JSON string literal (quotes, backslashes, control characters). Sysfs text such as a battery
// model name is device-controlled, so it must never be pasted into JSON as-is.
inline std::string json_escape(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (const unsigned char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (c < 0x20) {
                    static const char hex[] = "0123456789abcdef";
                    out += "\\u00";
                    out += hex[c >> 4];
                    out += hex[c & 0xF];
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    return out;
}

// Writes a complete JSON document into a caller buffer. A document that does not fit is an error (-1, empty buffer), never a
// silently truncated one that a parser would then reject. Returns `okCode` on success.
inline int copy_out_json(char* dst, int size, const std::string& json, int okCode) {
    if (!dst || size <= 0)
        return -1;
    if (json.size() >= static_cast<size_t>(size)) {
        dst[0] = '\0';
        return -1;
    }
    std::memcpy(dst, json.data(), json.size());
    dst[json.size()] = '\0';
    return okCode;
}

// Null out-pointers are valid and mean the caller does not want that value.
inline void si_mem_put(long long* p, long long value) {
    if (p)
        *p = value;
}
