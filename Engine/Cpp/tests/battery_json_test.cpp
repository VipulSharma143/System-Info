// Battery JSON: device-controlled text must be escaped, and a document that does not fit the caller's buffer is an error,
// never a truncated string. No hardware is assumed: the live call accepts "no battery" (0) or "battery present" (1).
#include "../include/native_engine.h"
#include "../src/internal.h"
#include <cstdio>
#include <string>

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::printf("FAILED: %s (line %d)\n", #cond, __LINE__); ++failures; } } while (0)

int main() {
    CHECK(json_escape("plain") == "plain");
    CHECK(json_escape("a\"b") == "a\\\"b");
    CHECK(json_escape("a\\b") == "a\\\\b");
    CHECK(json_escape("line\nbreak\ttab\r") == "line\\nbreak\\ttab\\r");
    CHECK(json_escape(std::string("x\x01y", 3)) == "x\\u0001y");
    CHECK(json_escape("Sony \xC3\xA9") == "Sony \xC3\xA9");   // UTF-8 passes through untouched

    char small[8];
    CHECK(copy_out_json(small, sizeof small, "{\"present\":false}", 0) == -1);   // does not fit
    CHECK(small[0] == '\0');
    char fits[32];
    CHECK(copy_out_json(fits, sizeof fits, "{\"present\":false}", 7) == 7);
    CHECK(std::string(fits) == "{\"present\":false}");
    CHECK(copy_out_json(nullptr, 10, "{}", 0) == -1);
    CHECK(copy_out_json(fits, 0, "{}", 0) == -1);

    char buf[4096];
    const int rc = get_battery_info_json(buf, sizeof buf);
    CHECK(rc == 0 || rc == 1);
    const std::string doc(buf);
    CHECK(doc.size() > 2 && doc.front() == '{' && doc.back() == '}');
    CHECK(rc == 1 ? doc.find("\"present\":true") != std::string::npos : doc == "{\"present\":false}");

    char tiny[4];
    CHECK(get_battery_info_json(tiny, sizeof tiny) == -1);   // never a truncated document
    CHECK(get_battery_info_json(nullptr, 100) == -1);
    CHECK(get_battery_info_json(buf, 0) == -1);

    if (failures == 0) std::puts("battery_json_test OK");
    return failures == 0 ? 0 : 1;
}
