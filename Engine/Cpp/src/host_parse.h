// host_parse.h — pure text parsers for /proc/stat and /proc/meminfo. No I/O, no allocation, no platform headers, so the
// same code is unit-tested with fixture text on every OS and reused by the Linux snapshot reader.
#pragma once

#include <cstddef>
#include <cstdint>

namespace si_parse {

struct MemFields {
    uint64_t total_kb = 0, available_kb = 0, free_kb = 0, swap_total_kb = 0, swap_free_kb = 0;
    bool have_total = false, have_available = false, have_free = false, have_swap_total = false, have_swap_free = false;
};

inline bool is_digit(char c) { return c >= '0' && c <= '9'; }

// Reads an unsigned decimal at `p` (after optional spaces). Returns false if there is none or it would overflow.
inline bool read_u64(const char*& p, const char* end, uint64_t& out) {
    while (p < end && (*p == ' ' || *p == '\t')) ++p;
    if (p >= end || !is_digit(*p)) return false;
    uint64_t v = 0;
    while (p < end && is_digit(*p)) {
        const uint64_t digit = static_cast<uint64_t>(*p - '0');
        if (v > (UINT64_MAX - digit) / 10) return false;
        v = v * 10 + digit;
        ++p;
    }
    out = v;
    return true;
}

// First line of /proc/stat: "cpu  user nice system idle iowait irq softirq steal [guest guest_nice]".
// total = the first eight fields (guest time is already inside user); idle = idle + iowait; busy = total - idle.
// Returns false if the line is not the aggregate "cpu" row or has fewer than four fields.
inline bool parse_stat_cpu_line(const char* text, size_t len, uint64_t& busy, uint64_t& total) {
    const char* p = text;
    const char* end = text + len;
    if (len < 5 || p[0] != 'c' || p[1] != 'p' || p[2] != 'u' || (p[3] != ' ' && p[3] != '\t')) return false;
    p += 3;

    uint64_t fields[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    int count = 0;
    while (count < 8 && p < end && *p != '\n') {
        if (!read_u64(p, end, fields[count])) break;
        ++count;
    }
    if (count < 4) return false;

    uint64_t sum = 0;
    for (int i = 0; i < count; ++i) {
        if (sum > UINT64_MAX - fields[i]) return false;
        sum += fields[i];
    }
    uint64_t idle = fields[3];
    if (count > 4) idle += fields[4];
    if (idle > sum) return false;
    total = sum;
    busy = sum - idle;
    return true;
}

inline bool key_is(const char* line, const char* line_end, const char* key, size_t key_len, const char*& value) {
    if (static_cast<size_t>(line_end - line) < key_len + 1) return false;
    for (size_t i = 0; i < key_len; ++i)
        if (line[i] != key[i]) return false;
    if (line[key_len] != ':') return false;
    value = line + key_len + 1;
    return true;
}

// /proc/meminfo: "MemTotal:       16314192 kB". Unknown keys are skipped. Values are kB.
inline MemFields parse_meminfo(const char* text, size_t len) {
    MemFields m;
    const char* p = text;
    const char* end = text + len;
    while (p < end) {
        const char* line_end = p;
        while (line_end < end && *line_end != '\n') ++line_end;

        const char* v = nullptr;
        uint64_t n = 0;
        if (key_is(p, line_end, "MemTotal", 8, v)) { const char* q = v; if (read_u64(q, line_end, n)) { m.total_kb = n; m.have_total = true; } }
        else if (key_is(p, line_end, "MemAvailable", 12, v)) { const char* q = v; if (read_u64(q, line_end, n)) { m.available_kb = n; m.have_available = true; } }
        else if (key_is(p, line_end, "MemFree", 7, v)) { const char* q = v; if (read_u64(q, line_end, n)) { m.free_kb = n; m.have_free = true; } }
        else if (key_is(p, line_end, "SwapTotal", 9, v)) { const char* q = v; if (read_u64(q, line_end, n)) { m.swap_total_kb = n; m.have_swap_total = true; } }
        else if (key_is(p, line_end, "SwapFree", 8, v)) { const char* q = v; if (read_u64(q, line_end, n)) { m.swap_free_kb = n; m.have_swap_free = true; } }

        p = line_end < end ? line_end + 1 : end;
    }
    return m;
}

}  // namespace si_parse
