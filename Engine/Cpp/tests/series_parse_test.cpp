// Saved-history reader: exact ticks, every skip rule, line endings, escapes, the "do not guess" cases and buffer shortfall.
// Tick constants were computed independently (Python datetime) rather than with the code under test.
#include "../include/native_engine.h"
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <tuple>
#include <vector>

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::printf("FAILED: %s (line %d)\n", #cond, __LINE__); ++failures; } } while (0)

static const long long T_A = 639274770151234567LL;   // 2026-10-13T08:30:15.1234567Z
static const long long T_B = 639274770150000000LL;   // 2026-10-13T08:30:15Z
static const long long ANY_FROM = 0, ANY_TO = 4000000000000000000LL;

struct Result {
    int rc = 0;
    long long rows = 0, malformed = 0;
    std::vector<long long> ticks;
    std::vector<double> cpu;
    std::vector<std::vector<std::tuple<std::string, double, double>>> net;
};

static Result parse(const std::string& text, long long from = ANY_FROM, long long to = ANY_TO) {
    Result r;
    const long long rowCap = (long long)text.size() + 2;   // a row needs at least one byte
    std::vector<long long> ticks(rowCap); std::vector<double> cpu(rowCap); std::vector<int> start(rowCap + 1);
    long long netCap = 64, namesCap = 256;
    for (int attempt = 0; attempt < 3; attempt++) {
        std::vector<int> iface(netCap); std::vector<double> rx(netCap), tx(netCap); std::vector<char> names(namesCap);
        SiSeriesBatch b{ticks.data(), cpu.data(), start.data(), iface.data(), rx.data(), tx.data(), names.data(), rowCap, netCap, namesCap, 0, 0, 0, 0, 0};
        r.rc = si_series_parse_lines((const unsigned char*)text.data(), (long long)text.size(), from, to, &b);
        r.rows = b.rows; r.malformed = b.malformed;
        if (r.rc == -1) { netCap = b.netEntries + 1; namesCap = b.namesBytes + 1; continue; }
        if (r.rc != 1) return r;
        std::vector<std::string> nameList;
        const char* q = names.data();
        for (long long i = 0; i < b.nameCount; i++) { nameList.push_back(q); q += nameList.back().size() + 1; }
        for (long long i = 0; i < b.rows; i++) {
            r.ticks.push_back(ticks[i]); r.cpu.push_back(cpu[i]);
            std::vector<std::tuple<std::string, double, double>> row;
            for (int k = start[i]; k < start[i + 1]; k++) row.emplace_back(nameList[iface[k]], rx[k], tx[k]);
            r.net.push_back(row);
        }
        return r;
    }
    return r;
}

static std::string line(const std::string& ts, const std::string& rest) { return "{\"timestamp\":\"" + ts + "\"" + rest + "}"; }

int main() {
    // ---- a normal line, exact ticks
    {
        auto r = parse(line("2026-10-13T08:30:15.1234567Z", ",\"cpuUsedPercent\":12.5,\"network\":[{\"iface\":\"eth0\",\"rxKBps\":1.5,\"txKBps\":2.25},{\"iface\":\"lo\",\"rxKBps\":0,\"txKBps\":0}]") + "\n");
        CHECK(r.rc == 1 && r.rows == 1 && r.malformed == 0);
        CHECK(r.ticks[0] == T_A && r.cpu[0] == 12.5);
        CHECK(r.net[0].size() == 2 && std::get<0>(r.net[0][0]) == "eth0" && std::get<1>(r.net[0][0]) == 1.5 && std::get<2>(r.net[0][0]) == 2.25 && std::get<0>(r.net[0][1]) == "lo");
    }
    // ---- timestamp forms the writer produces and close relatives
    CHECK(parse(line("2026-10-13T08:30:15Z", "")).ticks[0] == T_B);
    CHECK(parse(line("2026-10-13T08:30:15.0000000Z", "")).ticks[0] == T_B);
    CHECK(parse(line("2026-10-13T08:30:15.5Z", "")).ticks[0] == T_B + 5000000);
    CHECK(parse(line("2024-02-29T23:59:59.5Z", "")).ticks[0] == 638448479995000000LL);       // leap day
    CHECK(parse(line("0001-01-01T00:00:00Z", "")).ticks[0] == 0);
    CHECK(parse(line("9999-12-31T23:59:59.9999999Z", "")).ticks[0] == 3155378975999999999LL);
    // ---- forms it will not guess at: the managed reader decides
    CHECK(parse(line("2026-10-13T08:30:15+00:00", "")).rc == 0);
    CHECK(parse(line("2026-10-13T08:30:15.12345678Z", "")).rc == 0);
    CHECK(parse(line("2026-10-13t08:30:15z", "")).rc == 0);
    CHECK(parse(line("2026-10-13 08:30:15Z", "")).rc == 0);
    CHECK(parse(line("2026-02-30T08:30:15Z", "")).rc == 0);
    CHECK(parse(line("2026-10-13T24:00:00Z", "")).rc == 0);
    CHECK(parse(line("yesterday", "")).rc == 0);
    CHECK(parse("{\"timestamp\":\"2026-10-13T08:30:15\\u005aZ\"}\n").rc == 0);                 // escaped timestamp text

    // ---- malformed lines are counted and left out, the good ones around them kept
    {
        std::string text = line("2026-10-13T08:30:15Z", ",\"cpuUsedPercent\":1") + "\n"
            "{\"timestamp\":\"2026-10-13T08:30:16Z\",\"cpuUsedP\n"                    // half-written
            + line("2026-10-13T08:30:17Z", ",\"cpuUsedPercent\":3") + " junk\n"        // text after the object
            "not json at all\n"
            "{\"cpuUsedPercent\":5}\n"                                                // no timestamp
            "{\"timestamp\":12345}\n"                                                 // timestamp not text
            "[1,2,3]\n"
            "{\"timestamp\":\"2026-10-13T08:30:18Z\",}\n"                              // trailing comma
            "{\"timestamp\":\"2026-10-13T08:30:19Z\",\"x\":NaN}\n"                      // not JSON
            "{\"timestamp\":\"2026-10-13T08:30:20Z\",\"x\":01}\n"                       // leading zero
            "{\"timestamp\":\"2026-10-13T08:30:21Z\",\"x\":\"tab\there\"}\n"            // raw control char in a string
            + line("2026-10-13T08:30:22Z", ",\"cpuUsedPercent\":9") + "\n";
        auto r = parse(text);
        CHECK(r.rc == 1 && r.rows == 2 && r.malformed == 10);
        CHECK(r.cpu[0] == 1 && r.cpu[1] == 9);
    }
    // ---- blank lines are ignored (not counted), every line ending works, a byte-order mark is skipped
    {
        const std::string a = line("2026-10-13T08:30:15Z", ",\"cpuUsedPercent\":1"), b = line("2026-10-13T08:30:16Z", ",\"cpuUsedPercent\":2");
        for (const char* sep : {"\n", "\r\n", "\r", "\n\n  \n", "\r\n\r\n"}) {
            auto r = parse(a + sep + b + sep);
            CHECK(r.rc == 1 && r.rows == 2 && r.malformed == 0 && r.cpu[1] == 2);
        }
        CHECK(parse(a).rows == 1);                                                     // no final newline
        auto bom = parse("\xEF\xBB\xBF" + a + "\n" + b + "\n");
        CHECK(bom.rc == 1 && bom.rows == 2 && bom.malformed == 0);
        CHECK(parse("\xFF\xFE" + a).rc == 0);                                          // UTF-16 file: managed reader
        CHECK(parse(std::string("\x00\x00\xFE\xFF", 4) + a).rc == 0);                   // UTF-32
        CHECK(parse("").rc == 1 && parse("").rows == 0);
        CHECK(parse("\n\n  \n").rows == 0);
    }
    // ---- time range is inclusive at both ends
    {
        const std::string text = line("2026-10-13T08:30:15Z", "") + "\n" + line("2026-10-13T08:30:16Z", "") + "\n" + line("2026-10-13T08:30:17Z", "") + "\n";
        CHECK(parse(text, T_B, T_B + 10000000).rows == 2);
        CHECK(parse(text, T_B + 1, T_B + 10000000).rows == 1);
        CHECK(parse(text, T_B, T_B + 9999999).rows == 1);
        CHECK(parse(text, T_B + 30000000, ANY_TO).rows == 0);
    }
    // ---- duplicate and odd members: same rules as the managed reader
    {
        auto r = parse("{\"timestamp\":\"2026-10-13T08:30:15Z\",\"cpuUsedPercent\":1,\"timestamp\":\"1999-01-01T00:00:00Z\",\"cpuUsedPercent\":\"n/a\",\"cpuUsedPercent\":7,"
                       "\"network\":[{\"iface\":\"a\",\"rxKBps\":1}],\"network\":[{\"iface\":\"b\",\"txKBps\":2}],\"network\":5,\"other\":{\"deep\":[1,{\"x\":null}]}}\n");
        CHECK(r.rc == 1 && r.rows == 1 && r.ticks[0] == T_B);                          // the first timestamp wins
        CHECK(r.cpu[0] == 7);                                                           // the last numeric cpu wins; text does not clear it
        CHECK(r.net[0].size() == 2 && std::get<0>(r.net[0][0]) == "a" && std::get<0>(r.net[0][1]) == "b");   // arrays append, a non-array is ignored
        CHECK(std::isnan(std::get<2>(r.net[0][0])) && std::isnan(std::get<1>(r.net[0][1])));               // a missing rate is NaN
    }
    {
        auto r = parse(line("2026-10-13T08:30:15Z", ",\"network\":[7,[1],{\"iface\":5,\"rxKBps\":\"x\",\"txKBps\":3},{},{\"rxKBps\":4},{\"iface\":\"e\",\"iface\":null,\"rxKBps\":1,\"rxKBps\":\"later text\"}]"));
        CHECK(r.rc == 1 && r.net[0].size() == 4);                                       // non-objects are skipped; empty objects count
        CHECK(std::get<0>(r.net[0][0]) == "unknown" && std::isnan(std::get<1>(r.net[0][0])) && std::get<2>(r.net[0][0]) == 3);
        CHECK(std::get<0>(r.net[0][1]) == "unknown" && std::isnan(std::get<1>(r.net[0][1])));
        CHECK(std::get<0>(r.net[0][2]) == "unknown" && std::get<1>(r.net[0][2]) == 4);
        CHECK(std::get<0>(r.net[0][3]) == "unknown" && std::isnan(std::get<1>(r.net[0][3])));   // iface:null resets to unknown; the later text clears rx
    }
    // ---- escapes and non-ASCII in names
    {
        auto r = parse(line("2026-10-13T08:30:15Z", ",\"network\":[{\"iface\":\"wlan \\\"0\\\" \\u00e9\\n\"},{\"iface\":\"\xC3\xA9th\xE4\xB8\xAD\"},{\"iface\":\"\\ud83d\\ude00\"},{\"i\\u0066ace\":\"viaKey\"}]"));
        CHECK(r.rc == 1 && r.net[0].size() == 4);
        CHECK(std::get<0>(r.net[0][0]) == "wlan \"0\" \xC3\xA9\n");
        CHECK(std::get<0>(r.net[0][1]) == "\xC3\xA9th\xE4\xB8\xAD");
        CHECK(std::get<0>(r.net[0][2]) == "\xF0\x9F\x98\x80");
        CHECK(std::get<0>(r.net[0][3]) == "viaKey");
        CHECK(parse(line("2026-10-13T08:30:15Z", ",\"network\":[{\"iface\":\"\\ud800\"}]")).rc == 0);          // lone surrogate: managed reader
        CHECK(parse(line("2026-10-13T08:30:15Z", ",\"network\":[{\"iface\":\"a\\u0000b\"}]")).rc == 0);         // NUL in a name
        CHECK(parse(line("2026-10-13T08:30:15Z", ",\"x\":\"bad\xFF" "byte\"")).rc == 0);                         // invalid UTF-8
        CHECK(parse(line("2026-10-13T08:30:15Z", ",\"x\":\"\xC0\x80\"")).rc == 0);                               // overlong
        CHECK(parse(line("2026-10-13T08:30:15Z", ",\"x\":\"bad\\q\"")).malformed == 1);                          // bad escape: malformed
    }
    // ---- numbers
    {
        auto r = parse(line("2026-10-13T08:30:15Z", ",\"cpuUsedPercent\":-0.5e1,\"network\":[{\"iface\":\"a\",\"rxKBps\":1E3,\"txKBps\":2.5e-1}]"));
        CHECK(r.rc == 1 && r.cpu[0] == -5.0 && std::get<1>(r.net[0][0]) == 1000.0 && std::get<2>(r.net[0][0]) == 0.25);
        // a number the double type cannot hold: only a problem when the line is kept
        const std::string huge = line("2026-10-13T08:30:15Z", ",\"cpuUsedPercent\":1e400");
        CHECK(parse(huge).rc == 0);
        CHECK(parse(huge, T_B + 1, ANY_TO).rc == 1);
        CHECK(parse(line("2026-10-13T08:30:15Z", ",\"cpuUsedPercent\":1.}")).malformed == 1);
    }
    // ---- nesting limit: 64 containers open is allowed (the root counts), 65 is malformed
    {
        auto nested = [](int levels) { std::string s = "{\"timestamp\":\"2026-10-13T08:30:15Z\",\"x\":"; for (int i = 0; i < levels; i++) s += "["; for (int i = 0; i < levels; i++) s += "]"; return s + "}"; };
        CHECK(parse(nested(63)).rows == 1);
        CHECK(parse(nested(64)).malformed == 1);
    }
    // ---- buffers too small: the needed sizes come back, and a second call with them succeeds
    {
        std::string text;
        for (int i = 0; i < 50; i++)
            text += line("2026-10-13T08:30:15Z", ",\"network\":[{\"iface\":\"if" + std::to_string(i % 7) + "\",\"rxKBps\":1},{\"iface\":\"if" + std::to_string(i % 5) + "\"}]") + "\n";
        long long ticks[100]; double cpu[100]; int start[101];
        int iface[3]; double rx[3], tx[3]; char names[4];
        SiSeriesBatch b{ticks, cpu, start, iface, rx, tx, names, 100, 3, 4, 0, 0, 0, 0, 0};
        CHECK(si_series_parse_lines((const unsigned char*)text.data(), (long long)text.size(), ANY_FROM, ANY_TO, &b) == -1);
        CHECK(b.rows == 50 && b.netEntries == 100 && b.nameCount == 7 && b.namesBytes == 7 * 4);
        auto r = parse(text);
        CHECK(r.rc == 1 && r.rows == 50 && r.net[49].size() == 2);
    }
    // ---- too many distinct names: the managed reader
    {
        std::string net = "[";
        for (int i = 0; i < 300; i++) net += std::string(i ? "," : "") + "{\"iface\":\"n" + std::to_string(i) + "\"}";
        CHECK(parse(line("2026-10-13T08:30:15Z", ",\"network\":" + net + "]")).rc == 0);
    }
    // ---- bad arguments
    {
        SiSeriesBatch b{};
        CHECK(si_series_parse_lines(nullptr, 5, 0, 1, &b) == 0);
        CHECK(si_series_parse_lines((const unsigned char*)"x", 1, 0, 1, nullptr) == 0);
        CHECK(si_series_parse_lines((const unsigned char*)"x", -1, 0, 1, &b) == 0);
    }

    if (failures == 0) std::puts("series_parse_test OK");
    return failures == 0 ? 0 : 1;
}
