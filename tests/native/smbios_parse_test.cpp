// smbios_parse_test.cpp — unit tests for the SMBIOS Type 16 / Type 17 parser.
//
// Every test feeds a hand-built SMBIOS structure table to the *_from_table
// entry points, so nothing depends on the machine running the test (no root,
// no real DIMMs, same result on Linux and Windows CI). The values used here
// are made up on purpose; they are not any real machine's hardware.

#include "../../native/include/native_engine.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

// ---------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------

static int g_checks = 0;
static int g_failures = 0;

#define CHECK(cond)                                                          \
    do {                                                                     \
        ++g_checks;                                                          \
        if (!(cond)) {                                                       \
            ++g_failures;                                                    \
            std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);      \
        }                                                                    \
    } while (0)

#define CHECK_EQ_LL(actual, expected)                                        \
    do {                                                                     \
        ++g_checks;                                                          \
        const long long a_ = static_cast<long long>(actual);                 \
        const long long e_ = static_cast<long long>(expected);               \
        if (a_ != e_) {                                                      \
            ++g_failures;                                                    \
            std::printf("FAIL %s:%d  %s: got %lld, expected %lld\n",         \
                        __FILE__, __LINE__, #actual, a_, e_);                \
        }                                                                    \
    } while (0)

#define CHECK_EQ_STR(actual, expected)                                       \
    do {                                                                     \
        ++g_checks;                                                          \
        const std::string a_ = (actual);                                     \
        const std::string e_ = (expected);                                   \
        if (a_ != e_) {                                                      \
            ++g_failures;                                                    \
            std::printf("FAIL %s:%d  %s: got \"%s\", expected \"%s\"\n",     \
                        __FILE__, __LINE__, #actual, a_.c_str(),             \
                        e_.c_str());                                         \
        }                                                                    \
    } while (0)

static const long long KiB = 1024LL;
static const long long MiB = 1024LL * KiB;
static const long long GiB = 1024LL * MiB;

// ---------------------------------------------------------------------
// SMBIOS table builder
// ---------------------------------------------------------------------

using Bytes = std::vector<unsigned char>;

static void put16(Bytes& b, size_t off, unsigned v) {
    b[off] = static_cast<unsigned char>(v & 0xFF);
    b[off + 1] = static_cast<unsigned char>((v >> 8) & 0xFF);
}
static void put32(Bytes& b, size_t off, uint32_t v) {
    for (int i = 0; i < 4; ++i)
        b[off + i] = static_cast<unsigned char>((v >> (8 * i)) & 0xFF);
}
static void put64(Bytes& b, size_t off, uint64_t v) {
    for (int i = 0; i < 8; ++i)
        b[off + i] = static_cast<unsigned char>((v >> (8 * i)) & 0xFF);
}

// Appends one structure: formatted area (header + body, `length` bytes),
// then the NUL-terminated string set closed by an extra NUL.
static void append_record(Bytes& table, const Bytes& formatted,
                          const std::vector<std::string>& strings) {
    table.insert(table.end(), formatted.begin(), formatted.end());
    if (strings.empty()) {
        table.push_back(0);
        table.push_back(0);
        return;
    }
    for (const auto& s : strings) {
        table.insert(table.end(), s.begin(), s.end());
        table.push_back(0);
    }
    table.push_back(0);
}

struct Array16 {
    unsigned handle = 0x1000;
    unsigned errorCorrection = 0x03;     // None
    uint32_t maxCapacityKB = 16u * 1024u * 1024u;   // 16 GiB
    unsigned slots = 2;
    uint64_t extendedMaxBytes = 0;
    unsigned length = 0x17;
};

static void add_type16(Bytes& table, const Array16& a) {
    Bytes r(a.length, 0);
    r[0] = 16;
    r[1] = static_cast<unsigned char>(a.length);
    put16(r, 2, a.handle);
    r[0x04] = 3;                         // location: system board
    r[0x05] = 3;                         // use: system memory
    r[0x06] = static_cast<unsigned char>(a.errorCorrection);
    put32(r, 0x07, a.maxCapacityKB);
    if (a.length >= 0x0F) put16(r, 0x0D, a.slots);
    if (a.length >= 0x17) put64(r, 0x0F, a.extendedMaxBytes);
    append_record(table, r, {});
}

struct Device17 {
    unsigned handle = 0x1100;
    unsigned arrayHandle = 0x1000;
    unsigned totalWidth = 64;
    unsigned dataWidth = 64;
    unsigned size = 4096;                // field value: MiB unless bit 15 set
    unsigned formFactor = 0x0D;          // SODIMM
    unsigned memoryType = 0x1A;          // DDR4
    unsigned speed = 3200;
    unsigned configuredSpeed = 3200;
    unsigned attributes = 0x01;          // rank 1
    uint32_t extendedSizeMiB = 0;
    unsigned length = 0x28;
    // 1-based string indexes into `strings` (0 = not specified)
    unsigned locatorIdx = 1, bankIdx = 2, manufacturerIdx = 3,
             serialIdx = 4, partIdx = 5;
    std::vector<std::string> strings = {"DIMM0", "BANK 0", "TestMaker",
                                        "SN-0001", "PN-ABC-123"};
};

static void add_type17(Bytes& table, const Device17& d) {
    Bytes r(d.length, 0);
    // Deliberately short records are part of the tests, so every field write
    // is skipped when it would fall outside the record.
    auto fits = [&](size_t off, size_t width) { return off + width <= r.size(); };
    auto set8 = [&](size_t off, unsigned v) {
        if (fits(off, 1)) r[off] = static_cast<unsigned char>(v);
    };
    auto set16 = [&](size_t off, unsigned v) { if (fits(off, 2)) put16(r, off, v); };
    auto set32 = [&](size_t off, uint32_t v) { if (fits(off, 4)) put32(r, off, v); };

    set8(0, 17);
    set8(1, d.length);
    set16(2, d.handle);
    set16(0x04, d.arrayHandle);
    set16(0x08, d.totalWidth);
    set16(0x0A, d.dataWidth);
    set16(0x0C, d.size);
    set8(0x0E, d.formFactor);
    set8(0x10, d.locatorIdx);
    set8(0x11, d.bankIdx);
    set8(0x12, d.memoryType);
    set16(0x15, d.speed);
    set8(0x17, d.manufacturerIdx);
    set8(0x18, d.serialIdx);
    set8(0x1A, d.partIdx);
    set8(0x1B, d.attributes);
    set32(0x1C, d.extendedSizeMiB);
    set16(0x20, d.configuredSpeed);
    append_record(table, r, d.strings);
}

static void add_end(Bytes& table) {
    Bytes r = {127, 4, 0xFF, 0xFF};
    append_record(table, r, {});
}

// A structure of another type (BIOS info, type 0) the parser must skip.
static void add_other(Bytes& table, unsigned type) {
    Bytes r(0x12, 0);
    r[0] = static_cast<unsigned char>(type);
    r[1] = 0x12;
    append_record(table, r, {"Vendor", "1.0"});
}

// ---------------------------------------------------------------------
// Result wrappers
// ---------------------------------------------------------------------

struct Module {
    int ok = 0;
    std::string manufacturer, part, serial, locator, bank, form, type;
    long long capacity = -2, speed = -2, configured = -2;
    int dataWidth = -2, totalWidth = -2, rank = -2, ecc = -2;
};

static Module module_at(const Bytes& t, int index) {
    Module m;
    char mf[128], pn[128], sn[128], lo[128], bk[128], ff[128], ty[128];
    m.ok = si_get_memory_module_from_table(
        t.data(), static_cast<int>(t.size()), index,
        mf, sizeof mf, pn, sizeof pn, sn, sizeof sn, lo, sizeof lo,
        bk, sizeof bk, ff, sizeof ff, ty, sizeof ty,
        &m.capacity, &m.speed, &m.configured,
        &m.dataWidth, &m.totalWidth, &m.rank, &m.ecc);
    m.manufacturer = mf; m.part = pn; m.serial = sn; m.locator = lo;
    m.bank = bk; m.form = ff; m.type = ty;
    return m;
}

struct Summary {
    int ok = 0;
    long long installed = -2, maxCapacity = -2, maxModule = -2;
    int modules = -2, slots = -2;
};

static Summary summary_of(const Bytes& t) {
    Summary s;
    s.ok = si_get_memory_hardware_summary_from_table(
        t.data(), static_cast<int>(t.size()),
        &s.installed, &s.modules, &s.slots, &s.maxCapacity, &s.maxModule);
    return s;
}

// One 16 + N x 17 table with a given memory type, for the type-mapping tests.
static Bytes one_module_table(unsigned memoryType, unsigned formFactor = 0x0D) {
    Bytes t;
    add_type16(t, Array16{});
    Device17 d;
    d.memoryType = memoryType;
    d.formFactor = formFactor;
    add_type17(t, d);
    add_end(t);
    return t;
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

static void test_full_module_fields() {
    Bytes t;
    Array16 a;
    a.errorCorrection = 0x03;
    a.maxCapacityKB = 16u * 1024u * 1024u;
    a.slots = 2;
    add_type16(t, a);

    Device17 d0;
    d0.handle = 0x1100;
    d0.size = 2048;
    d0.memoryType = 0x18;                // DDR3
    d0.speed = 1600; d0.configuredSpeed = 1333;
    d0.attributes = 0x01;
    d0.strings = {"SLOT-A", "BANK 0", "Acme Memory", "00C526", "AM-001"};
    add_type17(t, d0);

    Device17 d1;
    d1.handle = 0x1101;
    d1.size = 4096;
    d1.memoryType = 0x18;
    d1.speed = 1600; d1.configuredSpeed = 1600;
    d1.attributes = 0x02;
    d1.strings = {"SLOT-B", "BANK 2", "Other Corp", "B320C61B", "OC-471"};
    add_type17(t, d1);
    add_end(t);

    const Module m0 = module_at(t, 0);
    CHECK(m0.ok == 1);
    CHECK_EQ_STR(m0.manufacturer, "Acme Memory");
    CHECK_EQ_STR(m0.part, "AM-001");
    CHECK_EQ_STR(m0.serial, "00C526");
    CHECK_EQ_STR(m0.locator, "SLOT-A");
    CHECK_EQ_STR(m0.bank, "BANK 0");
    CHECK_EQ_STR(m0.form, "SODIMM");
    CHECK_EQ_STR(m0.type, "DDR3");
    CHECK_EQ_LL(m0.capacity, 2 * GiB);
    CHECK_EQ_LL(m0.speed, 1600);
    CHECK_EQ_LL(m0.configured, 1333);       // read separately from rated speed
    CHECK_EQ_LL(m0.dataWidth, 64);
    CHECK_EQ_LL(m0.totalWidth, 64);
    CHECK_EQ_LL(m0.rank, 1);
    CHECK_EQ_LL(m0.ecc, 0);                 // array reports "None"

    const Module m1 = module_at(t, 1);
    CHECK(m1.ok == 1);
    CHECK_EQ_STR(m1.manufacturer, "Other Corp");
    CHECK_EQ_STR(m1.part, "OC-471");
    CHECK_EQ_STR(m1.serial, "B320C61B");
    CHECK_EQ_STR(m1.locator, "SLOT-B");
    CHECK_EQ_STR(m1.bank, "BANK 2");
    CHECK_EQ_LL(m1.capacity, 4 * GiB);
    CHECK_EQ_LL(m1.rank, 2);

    CHECK(module_at(t, 2).ok == 0);          // only two populated modules
    CHECK(module_at(t, -1).ok == 0);

    const Summary s = summary_of(t);
    CHECK(s.ok == 1);
    CHECK_EQ_LL(s.installed, 6 * GiB);
    CHECK_EQ_LL(s.modules, 2);
    CHECK_EQ_LL(s.slots, 2);
    CHECK_EQ_LL(s.maxCapacity, 16 * GiB);
    CHECK_EQ_LL(s.maxModule, -1);            // never max capacity / slots
}

static void test_memory_type_mapping() {
    struct Case { unsigned code; const char* name; };
    // Hexadecimal SMBIOS enum values — NOT decimal (0x18 is DDR3, not 24=DDR4).
    const Case cases[] = {
        {0x12, "DDR"},   {0x13, "DDR2"},  {0x14, "DDR2 FB-DIMM"},
        {0x18, "DDR3"},  {0x19, "FBD2"},  {0x1A, "DDR4"},
        {0x1B, "LPDDR"}, {0x1C, "LPDDR2"}, {0x1D, "LPDDR3"},
        {0x1E, "LPDDR4"}, {0x22, "DDR5"}, {0x23, "LPDDR5"},
    };
    for (const auto& c : cases) {
        const Module m = module_at(one_module_table(c.code), 0);
        CHECK(m.ok == 1);
        CHECK_EQ_STR(m.type, c.name);
    }

    // Decimal-confusion guards: 22 (0x16) and 24 (0x18) are different things.
    CHECK_EQ_STR(module_at(one_module_table(0x18), 0).type, "DDR3");
    CHECK(module_at(one_module_table(24), 0).type == "DDR3");
    CHECK(module_at(one_module_table(0x16), 0).type != "DDR3");
    CHECK(module_at(one_module_table(0x16), 0).type != "DDR4");

    // Unknown / reserved codes never get invented names.
    CHECK_EQ_STR(module_at(one_module_table(0x30), 0).type, "");
    CHECK_EQ_STR(module_at(one_module_table(0xFF), 0).type, "");
    CHECK_EQ_STR(module_at(one_module_table(0x00), 0).type, "");
    // The spec's own "Unknown" value is reported as that, not as a guess.
    CHECK_EQ_STR(module_at(one_module_table(0x02), 0).type, "Unknown");
}

static void test_form_factor() {
    CHECK_EQ_STR(module_at(one_module_table(0x1A, 0x09), 0).form, "DIMM");
    CHECK_EQ_STR(module_at(one_module_table(0x1A, 0x0D), 0).form, "SODIMM");
    CHECK_EQ_STR(module_at(one_module_table(0x1A, 0x0F), 0).form, "FB-DIMM");
    CHECK_EQ_STR(module_at(one_module_table(0x1A, 0x00), 0).form, "");
    CHECK_EQ_STR(module_at(one_module_table(0x1A, 0x63), 0).form, "");
}

static void test_type16_capacity() {
    // Plain value in KiB.
    {
        Bytes t; Array16 a; a.maxCapacityKB = 32u * 1024u * 1024u;   // 32 GiB
        add_type16(t, a); add_type17(t, Device17{}); add_end(t);
        CHECK_EQ_LL(summary_of(t).maxCapacity, 32 * GiB);
    }
    // 0x80000000 => the 64-bit extended field (bytes) is authoritative.
    {
        Bytes t; Array16 a; a.maxCapacityKB = 0x80000000u;
        a.extendedMaxBytes = 128ull * GiB;
        add_type16(t, a); add_type17(t, Device17{}); add_end(t);
        CHECK_EQ_LL(summary_of(t).maxCapacity, 128 * GiB);   // not 2 TiB from the DWORD
    }
    // Extended marker but structure too short to carry the QWORD => unknown.
    {
        Bytes t; Array16 a; a.maxCapacityKB = 0x80000000u; a.length = 0x0F;
        add_type16(t, a); add_type17(t, Device17{}); add_end(t);
        CHECK_EQ_LL(summary_of(t).maxCapacity, -1);
    }
    // Extended marker with a zero QWORD => unknown, not 0.
    {
        Bytes t; Array16 a; a.maxCapacityKB = 0x80000000u; a.extendedMaxBytes = 0;
        add_type16(t, a); add_type17(t, Device17{}); add_end(t);
        CHECK_EQ_LL(summary_of(t).maxCapacity, -1);
    }
    // 0 and 0xFFFFFFFF both mean "not reported".
    {
        Bytes t; Array16 a; a.maxCapacityKB = 0;
        add_type16(t, a); add_type17(t, Device17{}); add_end(t);
        CHECK_EQ_LL(summary_of(t).maxCapacity, -1);
        Bytes u; Array16 b; b.maxCapacityKB = 0xFFFFFFFFu;
        add_type16(u, b); add_type17(u, Device17{}); add_end(u);
        CHECK_EQ_LL(summary_of(u).maxCapacity, -1);
    }
}

static void test_slot_count() {
    const unsigned counts[] = {0, 0xFFFF};
    for (unsigned c : counts) {
        Bytes t; Array16 a; a.slots = c;
        add_type16(t, a); add_type17(t, Device17{}); add_end(t);
        const Summary s = summary_of(t);
        CHECK(s.ok == 1);
        CHECK_EQ_LL(s.slots, -1);            // never 65535 slots, never 0
    }
    Bytes t; Array16 a; a.slots = 4;
    add_type16(t, a); add_type17(t, Device17{}); add_end(t);
    CHECK_EQ_LL(summary_of(t).slots, 4);
}

static void test_module_capacity() {
    auto cap = [](unsigned sizeField, uint32_t ext = 0) {
        Bytes t; add_type16(t, Array16{});
        Device17 d; d.size = sizeField; d.extendedSizeMiB = ext;
        add_type17(t, d); add_end(t);
        return module_at(t, 0);
    };

    CHECK_EQ_LL(cap(8192).capacity, 8 * GiB);                 // MiB
    CHECK_EQ_LL(cap(0x8000 | 512).capacity, 512 * KiB);       // bit 15 => KiB
    CHECK_EQ_LL(cap(0x7FFF, 32768).capacity, 32 * GiB);       // extended size, MiB
    CHECK_EQ_LL(cap(0x7FFF, 262144).capacity, 256 * GiB);

    const Module unknownExt = cap(0x7FFF, 0);                 // extended marker, no value
    CHECK(unknownExt.ok == 1);
    CHECK_EQ_LL(unknownExt.capacity, -1);

    const Module unknown = cap(0xFFFF);                       // installed, size unknown
    CHECK(unknown.ok == 1);
    CHECK_EQ_LL(unknown.capacity, -1);

    // Size 0 is an EMPTY SLOT: not a module at all, not a "0 GB module".
    CHECK(cap(0).ok == 0);
}

static void test_empty_slots_are_not_modules() {
    Bytes t;
    Array16 a; a.slots = 4;
    add_type16(t, a);
    Device17 d0; d0.handle = 0x1100; d0.size = 8192;
    Device17 e1; e1.handle = 0x1101; e1.size = 0;       // empty
    Device17 d2; d2.handle = 0x1102; d2.size = 8192;
    d2.strings = {"DIMM2", "BANK 2", "Acme", "SN2", "PN2"};
    Device17 e3; e3.handle = 0x1103; e3.size = 0;       // empty
    add_type17(t, d0); add_type17(t, e1); add_type17(t, d2); add_type17(t, e3);
    add_end(t);

    const Summary s = summary_of(t);
    CHECK_EQ_LL(s.modules, 2);                           // populated only
    CHECK_EQ_LL(s.slots, 4);                             // slots - modules = empty
    CHECK_EQ_LL(s.installed, 16 * GiB);
    CHECK(module_at(t, 0).ok == 1);
    CHECK_EQ_STR(module_at(t, 1).locator, "DIMM2");      // index counts populated modules
    CHECK(module_at(t, 2).ok == 0);
}

static void test_rank() {
    auto rank = [](unsigned attr, unsigned length = 0x28) {
        Bytes t; add_type16(t, Array16{});
        Device17 d; d.attributes = attr; d.length = length;
        add_type17(t, d); add_end(t);
        return module_at(t, 0).rank;
    };
    CHECK_EQ_LL(rank(0x01), 1);
    CHECK_EQ_LL(rank(0x02), 2);
    CHECK_EQ_LL(rank(0x04), 4);
    CHECK_EQ_LL(rank(0x00), -1);        // 0 = unknown, not "rank 0"
    CHECK_EQ_LL(rank(0xF2), 2);         // only bits 3-0 are the rank
    CHECK_EQ_LL(rank(0xF0), -1);        // upper nibble alone is not a rank
    CHECK_EQ_LL(rank(0x02, 0x1B), -1);  // record too short to carry the attribute
}

static void test_speeds() {
    auto speeds = [](unsigned rated, unsigned configured, unsigned length = 0x28) {
        Bytes t; add_type16(t, Array16{});
        Device17 d; d.speed = rated; d.configuredSpeed = configured; d.length = length;
        add_type17(t, d); add_end(t);
        return module_at(t, 0);
    };
    Module m = speeds(3200, 2933);
    CHECK_EQ_LL(m.speed, 3200);
    CHECK_EQ_LL(m.configured, 2933);

    m = speeds(0, 0);
    CHECK_EQ_LL(m.speed, -1);           // 0 = unknown, never "0 MT/s"
    CHECK_EQ_LL(m.configured, -1);

    m = speeds(0xFFFF, 0xFFFF);
    CHECK_EQ_LL(m.speed, -1);
    CHECK_EQ_LL(m.configured, -1);

    m = speeds(4800, 0, 0x22);          // older record: configured speed present but 0
    CHECK_EQ_LL(m.speed, 4800);
    CHECK_EQ_LL(m.configured, -1);

    m = speeds(2400, 2400, 0x1B);       // SMBIOS 2.6-style: no configured-speed field
    CHECK_EQ_LL(m.speed, 2400);
    CHECK_EQ_LL(m.configured, -1);
}

static void test_widths() {
    Bytes t; add_type16(t, Array16{});
    Device17 d; d.dataWidth = 64; d.totalWidth = 72;     // ECC-style: total > data
    add_type17(t, d); add_end(t);
    Module m = module_at(t, 0);
    CHECK_EQ_LL(m.dataWidth, 64);
    CHECK_EQ_LL(m.totalWidth, 72);

    Bytes u; add_type16(u, Array16{});
    Device17 e; e.dataWidth = 0; e.totalWidth = 0xFFFF;
    add_type17(u, e); add_end(u);
    m = module_at(u, 0);
    CHECK_EQ_LL(m.dataWidth, -1);
    CHECK_EQ_LL(m.totalWidth, -1);
}

static void test_strings() {
    // Index 0 = "not specified".
    {
        Bytes t; add_type16(t, Array16{});
        Device17 d; d.manufacturerIdx = 0; d.serialIdx = 0; d.partIdx = 0;
        d.locatorIdx = 0; d.bankIdx = 0; d.strings = {};
        add_type17(t, d); add_end(t);
        const Module m = module_at(t, 0);
        CHECK(m.ok == 1);
        CHECK_EQ_STR(m.manufacturer, "");
        CHECK_EQ_STR(m.part, "");
        CHECK_EQ_STR(m.serial, "");
        CHECK_EQ_STR(m.locator, "");
        CHECK_EQ_STR(m.bank, "");
    }
    // Index past the end of the string set.
    {
        Bytes t; add_type16(t, Array16{});
        Device17 d; d.partIdx = 9;
        add_type17(t, d); add_end(t);
        CHECK_EQ_STR(module_at(t, 0).part, "");
        CHECK_EQ_STR(module_at(t, 0).manufacturer, "TestMaker");
    }
    // Strings shared / out of order are resolved by index, not position.
    {
        Bytes t; add_type16(t, Array16{});
        Device17 d; d.strings = {"Alpha", "Beta"};
        d.locatorIdx = 2; d.bankIdx = 1; d.manufacturerIdx = 2; d.serialIdx = 1; d.partIdx = 0;
        add_type17(t, d); add_end(t);
        const Module m = module_at(t, 0);
        CHECK_EQ_STR(m.locator, "Beta");
        CHECK_EQ_STR(m.bank, "Alpha");
        CHECK_EQ_STR(m.manufacturer, "Beta");
        CHECK_EQ_STR(m.serial, "Alpha");
        CHECK_EQ_STR(m.part, "");
    }
    // Firmware filler is passed through verbatim: judging it is the API layer's job.
    {
        Bytes t; add_type16(t, Array16{});
        Device17 d; d.strings = {"DIMM0", "BANK 0", "Not Specified", "Not Specified", "Not Specified"};
        add_type17(t, d); add_end(t);
        CHECK_EQ_STR(module_at(t, 0).manufacturer, "Not Specified");
    }
}

static void test_ecc() {
    auto ecc = [](unsigned errorCorrection) {
        Bytes t; Array16 a; a.errorCorrection = errorCorrection;
        add_type16(t, a); add_type17(t, Device17{}); add_end(t);
        return module_at(t, 0).ecc;
    };
    CHECK_EQ_LL(ecc(0x03), 0);      // None
    CHECK_EQ_LL(ecc(0x05), 1);      // Single-bit ECC
    CHECK_EQ_LL(ecc(0x06), 1);      // Multi-bit ECC
    CHECK_EQ_LL(ecc(0x04), -1);     // Parity: not claimed as ECC
    CHECK_EQ_LL(ecc(0x07), -1);     // CRC: not claimed as ECC
    CHECK_EQ_LL(ecc(0x01), -1);     // Other
    CHECK_EQ_LL(ecc(0x02), -1);     // Unknown
    CHECK_EQ_LL(ecc(0x99), -1);     // reserved

    // ECC comes from the array the module belongs to, matched by handle.
    Bytes t;
    Array16 a1; a1.handle = 0x1000; a1.errorCorrection = 0x06;
    Array16 a2; a2.handle = 0x1001; a2.errorCorrection = 0x03;
    add_type16(t, a1); add_type16(t, a2);
    Device17 d0; d0.handle = 0x1100; d0.arrayHandle = 0x1000;
    Device17 d1; d1.handle = 0x1101; d1.arrayHandle = 0x1001;
    Device17 d2; d2.handle = 0x1102; d2.arrayHandle = 0x7777;   // no such array
    add_type17(t, d0); add_type17(t, d1); add_type17(t, d2); add_end(t);
    CHECK_EQ_LL(module_at(t, 0).ecc, 1);
    CHECK_EQ_LL(module_at(t, 1).ecc, 0);
    CHECK_EQ_LL(module_at(t, 2).ecc, -1);     // unmatched handle: unknown, not "none"
}

static void test_multiple_arrays() {
    // Both arrays fully known => capacities and slots add up.
    {
        Bytes t;
        Array16 a1; a1.handle = 0x1000; a1.maxCapacityKB = 16u * 1024u * 1024u; a1.slots = 2;
        Array16 a2; a2.handle = 0x1001; a2.maxCapacityKB = 8u * 1024u * 1024u;  a2.slots = 1;
        add_type16(t, a1); add_type16(t, a2);
        Device17 d; d.arrayHandle = 0x1000;
        add_type17(t, d); add_end(t);
        const Summary s = summary_of(t);
        CHECK_EQ_LL(s.maxCapacity, 24 * GiB);
        CHECK_EQ_LL(s.slots, 3);
    }
    // One array unknown => the aggregate stays unknown (no misleading partial total).
    {
        Bytes t;
        Array16 a1; a1.handle = 0x1000; a1.maxCapacityKB = 16u * 1024u * 1024u; a1.slots = 2;
        Array16 a2; a2.handle = 0x1001; a2.maxCapacityKB = 0; a2.slots = 0;
        add_type16(t, a1); add_type16(t, a2);
        add_type17(t, Device17{}); add_end(t);
        const Summary s = summary_of(t);
        CHECK(s.ok == 1);
        CHECK_EQ_LL(s.maxCapacity, -1);
        CHECK_EQ_LL(s.slots, -1);
    }
}

static void test_unknown_module_size_makes_installed_unknown() {
    Bytes t; add_type16(t, Array16{});
    Device17 known; known.handle = 0x1100; known.size = 4096;
    Device17 unknown; unknown.handle = 0x1101; unknown.size = 0xFFFF;
    add_type17(t, known); add_type17(t, unknown); add_end(t);
    const Summary s = summary_of(t);
    CHECK(s.ok == 1);
    CHECK_EQ_LL(s.modules, 2);            // both are installed
    CHECK_EQ_LL(s.installed, -1);         // but the total is not knowable
}

static void test_no_modules() {
    // A Type 16 array with no Type 17 devices: slots may be known, installed is NOT 0.
    Bytes t; Array16 a; a.slots = 4;
    add_type16(t, a); add_end(t);
    const Summary s = summary_of(t);
    CHECK(s.ok == 1);
    CHECK_EQ_LL(s.installed, -1);
    CHECK_EQ_LL(s.modules, 0);
    CHECK_EQ_LL(s.slots, 4);
    CHECK(module_at(t, 0).ok == 0);

    // No memory structures at all.
    Bytes u; add_other(u, 0); add_end(u);
    CHECK(summary_of(u).ok == 0);
    CHECK(module_at(u, 0).ok == 0);
}

static void test_skips_unrelated_structures() {
    Bytes t;
    add_other(t, 0);                      // BIOS
    add_other(t, 1);                      // System
    add_type16(t, Array16{});
    add_other(t, 4);                      // Processor
    add_type17(t, Device17{});
    add_other(t, 9);
    add_end(t);
    CHECK_EQ_LL(summary_of(t).modules, 1);
    CHECK(module_at(t, 0).ok == 1);
}

static void test_end_of_table_stops_parsing() {
    Bytes t;
    add_type16(t, Array16{});
    add_type17(t, Device17{});
    add_end(t);
    Device17 late; late.handle = 0x1199;
    add_type17(t, late);                  // after the end marker: must be ignored
    CHECK_EQ_LL(summary_of(t).modules, 1);
    CHECK(module_at(t, 1).ok == 0);
}

static void test_short_type17_is_not_over_read() {
    // Shortest structure the parser accepts (0x1B): no rank / configured speed.
    Bytes t; add_type16(t, Array16{});
    Device17 d; d.length = 0x1B;
    add_type17(t, d); add_end(t);
    const Module m = module_at(t, 0);
    CHECK(m.ok == 1);
    CHECK_EQ_LL(m.rank, -1);
    CHECK_EQ_LL(m.configured, -1);
    CHECK_EQ_LL(m.capacity, 4 * GiB);

    // Below the minimum: not a usable module.
    Bytes u; add_type16(u, Array16{});
    Device17 tiny; tiny.length = 0x12;
    add_type17(u, tiny); add_end(u);
    CHECK(module_at(u, 0).ok == 0);
}

static void test_failure_leaves_unknown_outputs() {
    Bytes empty;
    long long cap = 123, sp = 123, cs = 123;
    int dw = 123, tw = 123, rk = 123, ec = 123;
    char mf[16] = "garbage", pn[16] = "garbage", sn[16] = "garbage", lo[16] = "garbage",
         bk[16] = "garbage", ff[16] = "garbage", ty[16] = "garbage";
    const int ok = si_get_memory_module_from_table(
        empty.data(), 0, 0, mf, sizeof mf, pn, sizeof pn, sn, sizeof sn, lo, sizeof lo,
        bk, sizeof bk, ff, sizeof ff, ty, sizeof ty, &cap, &sp, &cs, &dw, &tw, &rk, &ec);
    CHECK(ok == 0);
    CHECK_EQ_STR(mf, ""); CHECK_EQ_STR(pn, ""); CHECK_EQ_STR(sn, "");
    CHECK_EQ_STR(lo, ""); CHECK_EQ_STR(bk, ""); CHECK_EQ_STR(ff, ""); CHECK_EQ_STR(ty, "");
    CHECK_EQ_LL(cap, -1); CHECK_EQ_LL(sp, -1); CHECK_EQ_LL(cs, -1);
    CHECK_EQ_LL(dw, -1); CHECK_EQ_LL(tw, -1); CHECK_EQ_LL(rk, -1); CHECK_EQ_LL(ec, -1);

    long long inst = 123, maxc = 123, maxm = 123; int mods = 123, slots = 123;
    CHECK(si_get_memory_hardware_summary_from_table(
              empty.data(), 0, &inst, &mods, &slots, &maxc, &maxm) == 0);
    CHECK_EQ_LL(inst, -1); CHECK_EQ_LL(mods, -1); CHECK_EQ_LL(slots, -1);
    CHECK_EQ_LL(maxc, -1); CHECK_EQ_LL(maxm, -1);

    // A null table is "unavailable" — it must never fall through to the live system table.
    CHECK(si_get_memory_hardware_summary_from_table(
              nullptr, 100, &inst, &mods, &slots, &maxc, &maxm) == 0);
    CHECK(si_get_memory_module_from_table(
              nullptr, 100, 0, mf, sizeof mf, pn, sizeof pn, sn, sizeof sn, lo, sizeof lo,
              bk, sizeof bk, ff, sizeof ff, ty, sizeof ty, &cap, &sp, &cs, &dw, &tw, &rk, &ec) == 0);
}

static void test_small_and_null_buffers() {
    Bytes t; add_type16(t, Array16{});
    Device17 d; d.strings = {"DIMM0", "BANK 0", "VeryLongManufacturerName", "SN", "PN"};
    add_type17(t, d); add_end(t);

    // 4-byte buffers: truncated, always NUL-terminated, no overflow.
    char mf[4], pn[4], sn[4], lo[4], bk[4], ff[4], ty[4];
    long long cap, sp, cs; int dw, tw, rk, ec;
    const int ok = si_get_memory_module_from_table(
        t.data(), static_cast<int>(t.size()), 0,
        mf, sizeof mf, pn, sizeof pn, sn, sizeof sn, lo, sizeof lo,
        bk, sizeof bk, ff, sizeof ff, ty, sizeof ty, &cap, &sp, &cs, &dw, &tw, &rk, &ec);
    CHECK(ok == 1);
    CHECK_EQ_STR(mf, "Ver");
    CHECK(std::strlen(lo) <= 3);

    // Every output pointer may be null.
    CHECK(si_get_memory_module_from_table(
              t.data(), static_cast<int>(t.size()), 0,
              nullptr, 0, nullptr, 0, nullptr, 0, nullptr, 0, nullptr, 0, nullptr, 0, nullptr, 0,
              nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr) == 1);
    CHECK(si_get_memory_hardware_summary_from_table(
              t.data(), static_cast<int>(t.size()),
              nullptr, nullptr, nullptr, nullptr, nullptr) == 1);
}

static void test_truncated_and_hostile_tables() {
    Bytes good;
    add_type16(good, Array16{});
    add_type17(good, Device17{});
    add_end(good);

    // Every prefix of a valid table: must never crash or read out of bounds.
    for (size_t n = 0; n <= good.size(); ++n) {
        Bytes cut(good.begin(), good.begin() + n);
        if (!cut.empty()) {
            (void)summary_of(cut);
            (void)module_at(cut, 0);
        }
    }

    // Structure claims more bytes than exist.
    Bytes lie = {17, 0xFF, 0x00, 0x11, 0, 0, 0, 0};
    CHECK(module_at(lie, 0).ok == 0);

    // Length smaller than the 4-byte header.
    Bytes tiny = {17, 2, 0, 0, 0, 0};
    CHECK(module_at(tiny, 0).ok == 0);

    // Unterminated string area.
    Bytes open(0x28, 0); open[0] = 17; open[1] = 0x28; put16(open, 0x0C, 4096);
    open.push_back('A'); open.push_back('B');
    (void)module_at(open, 0);

    // Deterministic pseudo-random garbage, plus garbage spliced into a valid table.
    uint32_t seed = 0x12345678u;
    auto next = [&seed]() { seed = seed * 1664525u + 1013904223u; return static_cast<unsigned char>(seed >> 24); };
    for (int iter = 0; iter < 2000; ++iter) {
        Bytes junk(1 + (next() % 200));
        for (auto& b : junk) b = next();
        (void)summary_of(junk);
        (void)module_at(junk, 0);
        (void)module_at(junk, 3);

        Bytes mutated = good;
        for (int k = 0; k < 4; ++k) mutated[next() % mutated.size()] = next();
        (void)summary_of(mutated);
        (void)module_at(mutated, 0);
        (void)module_at(mutated, 1);
    }
    CHECK(true);   // reaching here without a crash (or a sanitizer report) is the assertion
}

int main() {
    test_full_module_fields();
    test_memory_type_mapping();
    test_form_factor();
    test_type16_capacity();
    test_slot_count();
    test_module_capacity();
    test_empty_slots_are_not_modules();
    test_rank();
    test_speeds();
    test_widths();
    test_strings();
    test_ecc();
    test_multiple_arrays();
    test_unknown_module_size_makes_installed_unknown();
    test_no_modules();
    test_skips_unrelated_structures();
    test_end_of_table_stops_parsing();
    test_short_type17_is_not_over_read();
    test_failure_leaves_unknown_outputs();
    test_small_and_null_buffers();
    test_truncated_and_hostile_tables();

    if (g_failures == 0) {
        std::printf("smbios_parse_test: all %d checks passed\n", g_checks);
        return 0;
    }
    std::printf("smbios_parse_test: %d of %d checks FAILED\n", g_failures, g_checks);
    return 1;
}
