// cpu_list.h — parser for the kernel's CPU list syntax ("0-11", "0,2,4-5"), used by the Linux hybrid-CPU detection.
#pragma once

#include <cstddef>
#include <set>
#include <string>

// Returns the CPU numbers named by `text`; malformed pieces are skipped, never guessed.
inline std::set<int> parse_cpu_list(const std::string& text) {
    std::set<int> result;
    std::size_t i = 0;
    const std::size_t n = text.size();

    auto number = [&](int& out) {
        if (i >= n || text[i] < '0' || text[i] > '9')
            return false;
        long long value = 0;
        while (i < n && text[i] >= '0' && text[i] <= '9') {
            value = value * 10 + (text[i] - '0');
            if (value > 1000000)
                return false;
            ++i;
        }
        out = static_cast<int>(value);
        return true;
    };

    while (i < n) {
        if (text[i] == ',' || text[i] == ' ' || text[i] == '\n' || text[i] == '\r') {
            ++i;
            continue;
        }
        int first = 0;
        if (!number(first)) {
            while (i < n && text[i] != ',')
                ++i;
            continue;
        }
        int last = first;
        if (i < n && text[i] == '-') {
            ++i;
            if (!number(last) || last < first) {
                while (i < n && text[i] != ',')
                    ++i;
                continue;
            }
        }
        for (int cpu = first; cpu <= last; ++cpu)
            result.insert(cpu);
    }
    return result;
}
