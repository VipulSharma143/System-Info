// series_parse.cpp — reads a day's snapshot file (one JSON object per line) into dense arrays for the Analytics maths.
//
// The managed reader this replaces (LocalJsonSnapshotStore.QueryAsync + AnalyticsService.ParseRow) parses every line twice
// into .NET strings and JSON readers; for a full day that is the largest cost of an Analytics request. The rules below are
// copied from it one for one (see the comment in native_engine.h), and anything that is not covered exactly is handed back
// to it (return 0) instead of being guessed at.
//
// The line scanner is a validating JSON reader, not a pattern match: a half-written or garbled line is rejected, as before.
// No global state: concurrent calls are fine.
#include "../include/native_engine.h"

#include <charconv>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <string>
#include <vector>

namespace {

constexpr int kMaxDepth = 64;            // same nesting limit as the managed JSON reader
constexpr size_t kMaxNames = 256;        // distinct interface names per call
constexpr size_t kMaxNameBytes = 1024;
constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();

enum Status { kOk = 0, kBad = 1, kUnsupported = 2 };   // kBad = malformed line (skipped); kUnsupported = use the managed reader

using uchar = unsigned char;

struct Span { const uchar* b = nullptr; const uchar* e = nullptr; };

inline bool is_ws(uchar c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }
inline void skip_ws(const uchar*& p, const uchar* e) { while (p < e && is_ws(*p)) ++p; }
inline bool is_digit(uchar c) { return c >= '0' && c <= '9'; }

int hex4(const uchar* p, const uchar* e, unsigned& out) {
    if (e - p < 4) return kBad;
    unsigned v = 0;
    for (int i = 0; i < 4; i++) {
        const uchar c = p[i];
        v <<= 4;
        if (c >= '0' && c <= '9') v |= c - '0';
        else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
        else return kBad;
    }
    out = v;
    return kOk;
}

void put_utf8(std::string& s, unsigned cp) {
    if (cp < 0x80) s += static_cast<char>(cp);
    else if (cp < 0x800) { s += static_cast<char>(0xC0 | (cp >> 6)); s += static_cast<char>(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) { s += static_cast<char>(0xE0 | (cp >> 12)); s += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); s += static_cast<char>(0x80 | (cp & 0x3F)); }
    else { s += static_cast<char>(0xF0 | (cp >> 18)); s += static_cast<char>(0x80 | ((cp >> 12) & 0x3F)); s += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); s += static_cast<char>(0x80 | (cp & 0x3F)); }
}

// Length of a well-formed UTF-8 sequence starting at p (lead byte >= 0x80), or 0 when it is not valid (overlong, surrogate,
// beyond U+10FFFF, truncated).
int utf8_len(const uchar* p, const uchar* e) {
    const uchar c = *p;
    if (c >= 0xC2 && c <= 0xDF) return (e - p >= 2 && (p[1] & 0xC0) == 0x80) ? 2 : 0;
    if (c >= 0xE0 && c <= 0xEF) {
        if (e - p < 3 || (p[1] & 0xC0) != 0x80 || (p[2] & 0xC0) != 0x80) return 0;
        if (c == 0xE0 && p[1] < 0xA0) return 0;
        if (c == 0xED && p[1] > 0x9F) return 0;
        return 3;
    }
    if (c >= 0xF0 && c <= 0xF4) {
        if (e - p < 4 || (p[1] & 0xC0) != 0x80 || (p[2] & 0xC0) != 0x80 || (p[3] & 0xC0) != 0x80) return 0;
        if (c == 0xF0 && p[1] < 0x90) return 0;
        if (c == 0xF4 && p[1] > 0x8F) return 0;
        return 4;
    }
    return 0;
}

struct Line {
    std::string scratch;     // decoded text of a string that contained escapes
    const uchar* end = nullptr;
    bool badNumber = false;  // a number outside the double range was met (matters only if the line is kept)
    // extracted
    bool haveTime = false;
    int64_t ticks = 0;
    double cpu = kNaN;
};

// p is on the opening quote. Validates the string; when `decode` and it contains escapes the decoded UTF-8 is left in
// line.scratch and the span points to it.
int parse_string(Line& line, const uchar*& p, bool decode, Span& out, bool& escaped) {
    const uchar* e = line.end;
    ++p;
    const uchar* start = p;
    escaped = false;
    for (;;) {
        while (p < e && *p != '"' && *p != '\\' && *p >= 0x20 && *p < 0x80) ++p;
        if (p >= e) return kBad;
        const uchar c = *p;
        if (c == '"') break;
        if (c < 0x20) return kBad;
        if (c >= 0x80) { const int n = utf8_len(p, e); if (!n) return kUnsupported; p += n; continue; }
        // backslash
        if (!escaped) {
            escaped = true;
            if (decode) line.scratch.assign(reinterpret_cast<const char*>(start), p - start);
        } else if (decode) {
            // text between the previous escape and this one was appended already
        }
        ++p;
        if (p >= e) return kBad;
        const uchar x = *p++;
        switch (x) {
            case '"': if (decode) line.scratch += '"'; break;
            case '\\': if (decode) line.scratch += '\\'; break;
            case '/': if (decode) line.scratch += '/'; break;
            case 'b': if (decode) line.scratch += '\b'; break;
            case 'f': if (decode) line.scratch += '\f'; break;
            case 'n': if (decode) line.scratch += '\n'; break;
            case 'r': if (decode) line.scratch += '\r'; break;
            case 't': if (decode) line.scratch += '\t'; break;
            case 'u': {
                unsigned cp;
                if (hex4(p, e, cp) != kOk) return kBad;
                p += 4;
                if (decode) {
                    if (cp >= 0xD800 && cp <= 0xDBFF) {
                        unsigned lo;
                        if (e - p >= 6 && p[0] == '\\' && p[1] == 'u' && hex4(p + 2, e, lo) == kOk && lo >= 0xDC00 && lo <= 0xDFFF) {
                            p += 6;
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        } else return kUnsupported;          // a lone surrogate cannot be represented
                    } else if (cp >= 0xDC00 && cp <= 0xDFFF) return kUnsupported;
                    if (cp == 0) return kUnsupported;         // an embedded NUL would end a name early
                    put_utf8(line.scratch, cp);
                }
                break;
            }
            default: return kBad;
        }
        if (decode) {
            // copy the plain run that follows, up to the next quote or backslash
            const uchar* run = p;
            while (p < e && *p != '"' && *p != '\\' && *p >= 0x20 && *p < 0x80) ++p;
            line.scratch.append(reinterpret_cast<const char*>(run), p - run);
        }
        start = p;
    }
    // p is on the closing quote
    if (escaped && decode) { out.b = reinterpret_cast<const uchar*>(line.scratch.data()); out.e = out.b + line.scratch.size(); }
    else { out.b = start; out.e = p; if (escaped) { /* not decoded: span is only the tail; callers that skip do not use it */ } }
    ++p;
    return kOk;
}

// JSON number grammar. The span is [b, e).
int parse_number(const uchar*& p, const uchar* e, Span& out) {
    const uchar* b = p;
    if (p < e && *p == '-') ++p;
    if (p >= e) return kBad;
    if (*p == '0') ++p;
    else if (*p >= '1' && *p <= '9') { while (p < e && is_digit(*p)) ++p; }
    else return kBad;
    if (p < e && *p == '.') { ++p; if (p >= e || !is_digit(*p)) return kBad; while (p < e && is_digit(*p)) ++p; }
    if (p < e && (*p == 'e' || *p == 'E')) {
        ++p;
        if (p < e && (*p == '+' || *p == '-')) ++p;
        if (p >= e || !is_digit(*p)) return kBad;
        while (p < e && is_digit(*p)) ++p;
    }
    out.b = b; out.e = p;
    return kOk;
}

bool number_to_double(Line& line, const Span& s, double& d) {
    const auto r = std::from_chars(reinterpret_cast<const char*>(s.b), reinterpret_cast<const char*>(s.e), d);
    if (r.ec != std::errc() || r.ptr != reinterpret_cast<const char*>(s.e) || !std::isfinite(d)) { line.badNumber = true; return false; }
    return true;
}

bool match_literal(const uchar*& p, const uchar* e, const char* lit) {
    const size_t n = std::strlen(lit);
    if (static_cast<size_t>(e - p) < n || std::memcmp(p, lit, n) != 0) return false;
    p += n;
    return true;
}

int skip_value(Line& line, const uchar*& p, int depth);

// Skips a container; p is on '[' or '{'. depth = containers open before this one.
int skip_container(Line& line, const uchar*& p, int depth) {
    const uchar* e = line.end;
    if (depth >= kMaxDepth) return kBad;
    const bool object = *p == '{';
    ++p;
    skip_ws(p, e);
    if (p < e && *p == (object ? '}' : ']')) { ++p; return kOk; }
    for (;;) {
        skip_ws(p, e);
        if (object) {
            if (p >= e || *p != '"') return kBad;
            Span k; bool esc;
            if (const int s = parse_string(line, p, false, k, esc)) return s;
            skip_ws(p, e);
            if (p >= e || *p != ':') return kBad;
            ++p;
        }
        if (const int s = skip_value(line, p, depth + 1)) return s;
        skip_ws(p, e);
        if (p >= e) return kBad;
        if (*p == ',') { ++p; continue; }
        if (*p == (object ? '}' : ']')) { ++p; return kOk; }
        return kBad;
    }
}

int skip_value(Line& line, const uchar*& p, int depth) {
    const uchar* e = line.end;
    skip_ws(p, e);
    if (p >= e) return kBad;
    switch (*p) {
        case '{': case '[': return skip_container(line, p, depth);
        case '"': { Span s; bool esc; return parse_string(line, p, false, s, esc); }
        case 't': return match_literal(p, e, "true") ? kOk : kBad;
        case 'f': return match_literal(p, e, "false") ? kOk : kBad;
        case 'n': return match_literal(p, e, "null") ? kOk : kBad;
        default: { Span s; return parse_number(p, e, s); }
    }
}

// ---- the interface name table (per call) ----
struct Names {
    std::vector<std::string> list;
    long long bytes = 0;   // sum of (length + 1)
    int find_or_add(const uchar* b, size_t n) {
        for (size_t i = 0; i < list.size(); i++)
            if (list[i].size() == n && std::memcmp(list[i].data(), b, n) == 0) return static_cast<int>(i);
        if (list.size() >= kMaxNames || n > kMaxNameBytes) return -1;
        list.emplace_back(reinterpret_cast<const char*>(b), n);
        bytes += static_cast<long long>(n) + 1;
        return static_cast<int>(list.size()) - 1;
    }
};

struct Out {
    SiSeriesBatch* batch;
    long long netCount = 0;                // entries written or counted so far
    void put_net(int iface, double rx, double tx) {
        if (netCount < batch->netCap) {
            batch->netIface[netCount] = iface;
            batch->rx[netCount] = rx;
            batch->tx[netCount] = tx;
        }
        ++netCount;
    }
};

// value of "network": p is on its first character
int parse_network(Line& line, const uchar*& p, Names& names, Out& out) {
    const uchar* e = line.end;
    if (*p != '[') return skip_value(line, p, 1);   // not an array: ignored, but still validated
    ++p;
    skip_ws(p, e);
    if (p < e && *p == ']') { ++p; return kOk; }
    for (;;) {
        skip_ws(p, e);
        if (p >= e) return kBad;
        if (*p != '{') {
            if (const int s = skip_value(line, p, 2)) return s;   // not an object: skipped
        } else {
            // one interface entry
            if (2 > kMaxDepth) return kBad;
            ++p;
            int iface = -1;                      // resolved at the end; -2 = default name
            bool haveName = false;
            std::string nameCopy;
            double rx = kNaN, tx = kNaN;
            skip_ws(p, e);
            if (p < e && *p == '}') { ++p; }
            else {
                for (;;) {
                    skip_ws(p, e);
                    if (p >= e || *p != '"') return kBad;
                    Span key; bool esc;
                    if (const int s = parse_string(line, p, true, key, esc)) return s;
                    const size_t kn = key.e - key.b;
                    const bool isIface = kn == 5 && std::memcmp(key.b, "iface", 5) == 0;
                    const bool isRx = kn == 6 && std::memcmp(key.b, "rxKBps", 6) == 0;
                    const bool isTx = kn == 6 && std::memcmp(key.b, "txKBps", 6) == 0;
                    skip_ws(p, e);
                    if (p >= e || *p != ':') return kBad;
                    ++p;
                    skip_ws(p, e);
                    if (p >= e) return kBad;
                    if (isIface) {
                        if (*p == '"') {
                            Span v; bool vesc;
                            if (const int s = parse_string(line, p, true, v, vesc)) return s;
                            nameCopy.assign(reinterpret_cast<const char*>(v.b), v.e - v.b);
                            haveName = true;
                        } else {
                            if (const int s = skip_value(line, p, 3)) return s;
                            haveName = false;            // a non-text name is "unknown"
                        }
                    } else if (isRx || isTx) {
                        double d = kNaN;
                        if (*p == '-' || is_digit(*p)) {
                            Span num;
                            if (const int s = parse_number(p, e, num)) return s;
                            if (!number_to_double(line, num, d)) d = kNaN;
                        } else if (const int s = skip_value(line, p, 3)) return s;
                        (isRx ? rx : tx) = d;
                    } else if (const int s = skip_value(line, p, 3)) return s;

                    skip_ws(p, e);
                    if (p >= e) return kBad;
                    if (*p == ',') { ++p; continue; }
                    if (*p == '}') { ++p; break; }
                    return kBad;
                }
            }
            static const uchar kUnknown[] = {'u', 'n', 'k', 'n', 'o', 'w', 'n'};
            iface = haveName ? names.find_or_add(reinterpret_cast<const uchar*>(nameCopy.data()), nameCopy.size())
                             : names.find_or_add(kUnknown, sizeof kUnknown);
            if (iface < 0) return kUnsupported;
            out.put_net(iface, rx, tx);
        }
        skip_ws(p, e);
        if (p >= e) return kBad;
        if (*p == ',') { ++p; continue; }
        if (*p == ']') { ++p; return kOk; }
        return kBad;
    }
}

// "YYYY-MM-DDTHH:MM:SS[.f{1,7}]Z" -> .NET ticks. Anything else, including values outside the usual ranges, is
// kUnsupported (the managed reader decides what those mean).
int parse_time(const Span& s, int64_t& ticks) {
    const size_t n = s.e - s.b;
    if (n < 20 || n > 28) return kUnsupported;
    const uchar* t = s.b;
    auto d2 = [&](size_t i) -> int { return (is_digit(t[i]) && is_digit(t[i + 1])) ? (t[i] - '0') * 10 + (t[i + 1] - '0') : -1; };
    const int y1 = d2(0), y2 = d2(2), mo = d2(5), dd = d2(8), hh = d2(11), mi = d2(14), ss = d2(17);
    if (y1 < 0 || y2 < 0 || mo < 0 || dd < 0 || hh < 0 || mi < 0 || ss < 0) return kUnsupported;
    if (t[4] != '-' || t[7] != '-' || t[10] != 'T' || t[13] != ':' || t[16] != ':') return kUnsupported;
    const int year = y1 * 100 + y2;
    int64_t frac = 0;
    size_t i = 19;
    if (t[i] == '.') {
        ++i;
        int digits = 0;
        while (i < n && is_digit(t[i])) { if (digits < 7) { frac = frac * 10 + (t[i] - '0'); } ++digits; ++i; }
        if (digits < 1 || digits > 7) return kUnsupported;
        for (int k = digits; k < 7; k++) frac *= 10;
    }
    if (i != n - 1 || t[i] != 'Z') return kUnsupported;
    if (year < 1 || mo < 1 || mo > 12 || hh > 23 || mi > 59 || ss > 59 || dd < 1) return kUnsupported;
    static const int dim[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    const bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    if (dd > dim[mo - 1] + ((mo == 2 && leap) ? 1 : 0)) return kUnsupported;
    // days since 0001-01-01 (proleptic Gregorian)
    const int64_t y = year - 1;
    int64_t days = y * 365 + y / 4 - y / 100 + y / 400;
    static const int cum[] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
    days += cum[mo - 1] + ((mo > 2 && leap) ? 1 : 0) + (dd - 1);
    ticks = ((days * 86400 + hh * 3600 + mi * 60 + ss) * 10000000LL) + frac;
    return kOk;
}

// Parses one line (the whole of [b, e)). Fills `line` and the network entries in `out` (the caller rolls them back when the
// line is not kept).
int parse_line(Line& line, const uchar* b, const uchar* e, Names& names, Out& out) {
    line.end = e;
    line.haveTime = false;
    line.cpu = kNaN;
    line.badNumber = false;
    const uchar* p = b;
    skip_ws(p, e);
    if (p >= e || *p != '{') return kBad;
    ++p;
    bool timeBad = false;
    int timeStatus = kOk;
    bool timeSeen = false;
    skip_ws(p, e);
    if (p < e && *p == '}') { ++p; }
    else {
        for (;;) {
            skip_ws(p, e);
            if (p >= e || *p != '"') return kBad;
            Span key; bool esc;
            if (const int s = parse_string(line, p, true, key, esc)) return s;
            const size_t kn = key.e - key.b;
            const bool isTime = kn == 9 && std::memcmp(key.b, "timestamp", 9) == 0;
            const bool isCpu = kn == 14 && std::memcmp(key.b, "cpuUsedPercent", 14) == 0;
            const bool isNet = kn == 7 && std::memcmp(key.b, "network", 7) == 0;
            skip_ws(p, e);
            if (p >= e || *p != ':') return kBad;
            ++p;
            skip_ws(p, e);
            if (p >= e) return kBad;
            if (isTime && !timeSeen) {
                timeSeen = true;
                if (*p != '"') { if (const int s = skip_value(line, p, 1)) return s; timeBad = true; }   // not text: the line has no usable time
                else {
                    Span v; bool vesc;
                    if (const int s = parse_string(line, p, false, v, vesc)) return s;
                    if (vesc) timeStatus = kUnsupported;
                    else if (const int s = parse_time(v, line.ticks)) timeStatus = s;
                    else line.haveTime = true;
                }
            } else if (isCpu && (*p == '-' || is_digit(*p))) {
                Span num;
                if (const int s = parse_number(p, e, num)) return s;
                double d;
                if (number_to_double(line, num, d)) line.cpu = d;
            } else if (isNet) {
                if (const int s = parse_network(line, p, names, out)) return s;
            } else if (const int s = skip_value(line, p, 1)) return s;

            skip_ws(p, e);
            if (p >= e) return kBad;
            if (*p == ',') { ++p; continue; }
            if (*p == '}') { ++p; break; }
            return kBad;
        }
    }
    skip_ws(p, e);
    if (p != e) return kBad;                       // anything after the object
    if (timeBad || !timeSeen) return kBad;         // no usable timestamp
    if (timeStatus != kOk) return timeStatus;      // unusual timestamp format: let the managed reader decide
    return kOk;
}

}  // namespace

extern "C" int si_series_parse_lines(const unsigned char* data, long long len, long long fromTicks, long long toTicks, SiSeriesBatch* batch) {
    if (!batch || len < 0 || (len > 0 && !data)) return 0;
    batch->rows = batch->netEntries = batch->nameCount = batch->namesBytes = batch->malformed = 0;
    if (len == 0) return 1;

    const uchar* p = data;
    const uchar* const end = data + len;
    // UTF-16 / UTF-32 files are decoded by the managed reader; a UTF-8 byte-order mark is simply skipped.
    if (len >= 2 && ((p[0] == 0xFF && p[1] == 0xFE) || (p[0] == 0xFE && p[1] == 0xFF))) return 0;
    if (len >= 4 && p[0] == 0 && p[1] == 0 && p[2] == 0xFE && p[3] == 0xFF) return 0;
    if (len >= 3 && p[0] == 0xEF && p[1] == 0xBB && p[2] == 0xBF) p += 3;

    const bool hasCr = std::memchr(p, '\r', static_cast<size_t>(end - p)) != nullptr;

    Names names;
    Out out{batch};
    Line line;
    long long rows = 0;
    const long long rowCap = batch->rowCap;

    while (p < end) {
        // one line: [p, lineEnd)
        const uchar* lineEnd;
        const uchar* next;
        if (!hasCr) {
            const void* nl = std::memchr(p, '\n', static_cast<size_t>(end - p));
            lineEnd = nl ? static_cast<const uchar*>(nl) : end;
            next = nl ? lineEnd + 1 : end;
        } else {
            lineEnd = p;
            while (lineEnd < end && *lineEnd != '\n' && *lineEnd != '\r') ++lineEnd;
            next = lineEnd;
            if (next < end) { if (*next == '\r' && next + 1 < end && next[1] == '\n') next += 2; else ++next; }
        }
        const uchar* b = p;
        p = next;

        const uchar* t = b;
        skip_ws(t, lineEnd);
        if (t == lineEnd) continue;                    // blank line

        const long long netBefore = out.netCount;
        const int status = parse_line(line, b, lineEnd, names, out);
        if (status == kUnsupported) return 0;
        if (status == kBad) { ++batch->malformed; out.netCount = netBefore; continue; }
        if (line.ticks < fromTicks || line.ticks > toTicks) { out.netCount = netBefore; continue; }
        if (line.badNumber) return 0;                  // a kept line holds a number the double type cannot represent
        if (netBefore > INT32_MAX || out.netCount > INT32_MAX) return 0;

        if (rows < rowCap) {
            batch->ticks[rows] = line.ticks;
            batch->cpu[rows] = line.cpu;
            batch->netStart[rows] = static_cast<int>(netBefore);
        }
        ++rows;
    }
    if (rows <= rowCap) batch->netStart[rows] = static_cast<int>(out.netCount);

    batch->rows = rows;
    batch->netEntries = out.netCount;
    batch->nameCount = static_cast<long long>(names.list.size());
    batch->namesBytes = names.bytes;
    if (rows > rowCap || out.netCount > batch->netCap || names.bytes > batch->namesCap) return -1;

    char* w = batch->names;
    for (const auto& n : names.list) { std::memcpy(w, n.data(), n.size()); w += n.size(); *w++ = '\0'; }
    return 1;
}
