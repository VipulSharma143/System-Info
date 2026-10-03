// smbios_loader_test.cpp — tests for how the SMBIOS table reaches the parser:
// the Windows RawSMBIOSData header, and the Linux memory-only snapshot.
//
// Windows returns the SMBIOS table wrapped in an 8-byte RawSMBIOSData header.
// The code that strips it is the only Windows-specific part of the memory
// hardware reader, and it is platform independent, so it is tested here with
// hand-built buffers on every host.
//
// This file #includes hardware_info.cpp directly to reach the static helper,
// so it must NOT also link systemmonitor_native (duplicate symbols); see the
// smbios_loader_test target in native/CMakeLists.txt.

#include "../../native/src/hardware_info.cpp"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#ifndef _WIN32
#include <sys/stat.h>
#include <unistd.h>
#endif

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

using Bytes = std::vector<unsigned char>;

static void put32(Bytes& b, size_t off, unsigned v) {
    for (int i = 0; i < 4; ++i)
        b[off + i] = static_cast<unsigned char>((v >> (8 * i)) & 0xFF);
}

// A minimal valid structure table: one Type 17 (4 GiB DDR4 SODIMM) + end marker.
static Bytes tiny_table() {
    Bytes t(0x28, 0);
    t[0] = 17; t[1] = 0x28; t[2] = 0x00; t[3] = 0x11;        // type, length, handle
    t[0x0C] = 0x00; t[0x0D] = 0x10;                          // size = 0x1000 MiB
    t[0x0E] = 0x0D;                                          // SODIMM
    t[0x12] = 0x1A;                                          // DDR4
    t[0x15] = 0x80; t[0x16] = 0x0C;                          // 3200 MT/s
    t.push_back(0); t.push_back(0);                          // empty string set
    const unsigned char end[] = {127, 4, 0xFF, 0xFF, 0, 0};
    t.insert(t.end(), end, end + sizeof end);
    return t;
}

// Wraps a table the way GetSystemFirmwareTable('RSMB') does.
static Bytes wrap(const Bytes& table, unsigned declaredLength, size_t padding = 0) {
    Bytes raw(8, 0);
    raw[0] = 0;          // Used20CallingMethod
    raw[1] = 3;          // SMBIOS major
    raw[2] = 4;          // SMBIOS minor
    raw[3] = 0;          // DMI revision
    put32(raw, 4, declaredLength);
    raw.insert(raw.end(), table.begin(), table.end());
    raw.insert(raw.end(), padding, 0xEE);
    return raw;
}

int main() {
    const Bytes table = tiny_table();
    Bytes out;

    // Normal case: header stripped, table returned byte-for-byte.
    {
        const Bytes raw = wrap(table, static_cast<unsigned>(table.size()));
        CHECK(si_dmi_extract_rsmb(raw.data(), raw.size(), out));
        CHECK(out == table);
    }

    // Trailing bytes beyond the declared Length are padding, not table.
    {
        const Bytes raw = wrap(table, static_cast<unsigned>(table.size()), 16);
        CHECK(si_dmi_extract_rsmb(raw.data(), raw.size(), out));
        CHECK(out == table);
        CHECK(out.size() == table.size());
    }

    // Declared Length larger than what was received is clamped, never over-read.
    {
        const Bytes raw = wrap(table, 0x00FFFFFF);
        CHECK(si_dmi_extract_rsmb(raw.data(), raw.size(), out));
        CHECK(out == table);
    }
    {
        const Bytes raw = wrap(table, 0xFFFFFFFFu);
        CHECK(si_dmi_extract_rsmb(raw.data(), raw.size(), out));
        CHECK(out == table);
    }

    // Declared Length smaller than the buffer: only that many bytes are used.
    {
        const Bytes raw = wrap(table, 10);
        CHECK(si_dmi_extract_rsmb(raw.data(), raw.size(), out));
        CHECK(out.size() == 10);
        CHECK(Bytes(table.begin(), table.begin() + 10) == out);
    }

    // Unusable inputs report failure and leave an empty table.
    {
        const Bytes zero = wrap(table, 0);
        out.assign(5, 1);
        CHECK(!si_dmi_extract_rsmb(zero.data(), zero.size(), out));
        CHECK(out.empty());

        const Bytes three = wrap(table, 3);                 // below the 4-byte minimum
        CHECK(!si_dmi_extract_rsmb(three.data(), three.size(), out));

        const Bytes headerOnly(8, 0);
        CHECK(!si_dmi_extract_rsmb(headerOnly.data(), headerOnly.size(), out));

        const Bytes shorter(5, 0);
        CHECK(!si_dmi_extract_rsmb(shorter.data(), shorter.size(), out));

        CHECK(!si_dmi_extract_rsmb(nullptr, 100, out));
        CHECK(!si_dmi_extract_rsmb(table.data(), 0, out));
    }

    // End to end: a wrapped table goes through the extractor and into the real
    // Type 17 parser, exactly as the Windows path does it.
    {
        const Bytes raw = wrap(table, static_cast<unsigned>(table.size()), 8);
        Bytes extracted;
        CHECK(si_dmi_extract_rsmb(raw.data(), raw.size(), extracted));

        char mf[64], pn[64], sn[64], lo[64], bk[64], ff[64], ty[64];
        long long cap = 0, sp = 0, cs = 0;
        int dw = 0, tw = 0, rk = 0, ec = 0;
        const int ok = si_memory_module_impl(
            extracted.data(), extracted.size(), 0,
            mf, sizeof mf, pn, sizeof pn, sn, sizeof sn, lo, sizeof lo,
            bk, sizeof bk, ff, sizeof ff, ty, sizeof ty,
            &cap, &sp, &cs, &dw, &tw, &rk, &ec);
        CHECK(ok == 1);
        CHECK(cap == 4LL * 1024 * 1024 * 1024);
        CHECK(sp == 3200);
        CHECK(std::string(ty) == "DDR4");
        CHECK(std::string(ff) == "SODIMM");
    }

    // The wrong offset would be caught here: treating the 8-byte header as part
    // of the table makes the first record unparseable.
    {
        const Bytes raw = wrap(table, static_cast<unsigned>(table.size()));
        long long inst = 0, maxc = 0, maxm = 0; int mods = 0, slots = 0;
        const int ok = si_memory_hardware_summary_impl(
            raw.data(), raw.size(), &inst, &mods, &slots, &maxc, &maxm);
        CHECK(ok == 0);      // unwrapped header bytes are not a valid table
    }


    // ---------------------------------------------------------------
    // Memory-only snapshot: filter
    // ---------------------------------------------------------------

    // A realistic mixed table: BIOS, a System record carrying a serial number
    // and UUID, a baseboard, the memory records, and the end marker.
    auto record = [](unsigned type, unsigned length, const std::vector<std::string>& strings) {
        Bytes r(length, 0);
        r[0] = static_cast<unsigned char>(type);
        r[1] = static_cast<unsigned char>(length);
        r[2] = static_cast<unsigned char>(type); r[3] = 0x00;
        for (const auto& str : strings) {
            r.insert(r.end(), str.begin(), str.end());
            r.push_back(0);
        }
        if (strings.empty()) r.push_back(0);
        r.push_back(0);
        return r;
    };
    auto append = [](Bytes& dst, const Bytes& src) { dst.insert(dst.end(), src.begin(), src.end()); };

    const std::string kSerial = "MACHINE-SERIAL-9F3A";
    const std::string kUuid = "UUID-DEADBEEF-1234";

    Bytes mixed;
    append(mixed, record(0, 0x18, {"BIOS Vendor", "1.0"}));
    {
        Bytes sys = record(1, 0x1B, {"Maker", "Model", "1.0", kSerial});
        for (size_t i = 0; i < kUuid.size() && 8 + i < 0x1B; ++i) sys[8 + i] = static_cast<unsigned char>(kUuid[i]);
        append(mixed, sys);
    }
    append(mixed, record(2, 0x08, {"Board", "Prod", "1.0", "BOARD-SERIAL-77"}));
    {
        Bytes t16(0x17, 0); t16[0] = 16; t16[1] = 0x17; t16[2] = 0x00; t16[3] = 0x10; t16[6] = 0x03;
        put32(t16, 7, 16u * 1024u * 1024u); t16[0x0D] = 2;
        t16.push_back(0); t16.push_back(0);
        append(mixed, t16);
    }
    {
        Bytes dev = tiny_table();                      // Type 17 (4 GiB DDR4) + end marker
        dev.resize(dev.size() - 6);                    // drop that end marker; added below
        dev[4] = 0x00; dev[5] = 0x10;                  // belongs to array 0x1000
        // give it a module serial the app is allowed to show
        dev.resize(0x28);
        dev[0x18] = 1;                                 // serial string index
        const std::string modSerial = "MODULE-SN-1";
        dev.insert(dev.end(), modSerial.begin(), modSerial.end());
        dev.push_back(0); dev.push_back(0);
        append(mixed, dev);
    }
    append(mixed, record(4, 0x1A, {"CPU Socket", "CPU Maker", "CPU-SERIAL-55"}));
    append(mixed, record(127, 4, {}));

    Bytes filtered;
    CHECK(si_dmi_filter_memory_records(mixed.data(), mixed.size(), filtered));
    auto contains = [](const Bytes& hay, const std::string& needle) {
        return std::search(hay.begin(), hay.end(), needle.begin(), needle.end()) != hay.end();
    };
    CHECK(!contains(filtered, kSerial));                  // machine serial never copied
    CHECK(!contains(filtered, kUuid));                    // UUID never copied
    CHECK(!contains(filtered, "BOARD-SERIAL-77"));
    CHECK(!contains(filtered, "CPU-SERIAL-55"));
    CHECK(!contains(filtered, "BIOS Vendor"));
    CHECK(contains(filtered, "MODULE-SN-1"));             // the memory module's own data is kept
    CHECK(filtered.size() < mixed.size());
    const Bytes memoryTable = filtered;                   // stable copy: `filtered` is reused below
    CHECK(filtered[0] == 16);                             // Type 16 first, in original order
    CHECK(filtered[filtered.size() - 6] == 127);          // properly terminated

    // The filtered table parses to the same module the original does.
    {
        char mf[64], pn[64], sn[64], lo[64], bk[64], ff[64], ty[64];
        long long cap = 0, sp = 0, cs = 0; int dw = 0, tw = 0, rk = 0, ec = 0;
        CHECK(si_memory_module_impl(filtered.data(), filtered.size(), 0,
                mf, sizeof mf, pn, sizeof pn, sn, sizeof sn, lo, sizeof lo, bk, sizeof bk,
                ff, sizeof ff, ty, sizeof ty, &cap, &sp, &cs, &dw, &tw, &rk, &ec) == 1);
        CHECK(cap == 4LL * 1024 * 1024 * 1024);
        CHECK(std::string(sn) == "MODULE-SN-1");
        CHECK(ec == 0);                                   // ECC info still resolved through the kept Type 16
    }

    // No memory records at all => nothing to save.
    {
        Bytes none; append(none, record(0, 0x18, {"BIOS"})); append(none, record(127, 4, {}));
        CHECK(!si_dmi_filter_memory_records(none.data(), none.size(), filtered));
        CHECK(filtered.empty());
        CHECK(!si_dmi_filter_memory_records(nullptr, 10, filtered));
        CHECK(!si_dmi_filter_memory_records(mixed.data(), 0, filtered));
    }
    // A table cut off mid-record keeps the complete memory records before the cut.
    {
        Bytes cut(mixed.begin(), mixed.end() - 20);
        CHECK(si_dmi_filter_memory_records(cut.data(), cut.size(), filtered));
        CHECK(!contains(filtered, kSerial));
    }
    // Hostile input never crashes the filter.
    {
        uint32_t seed = 0xC0FFEEu;
        auto next = [&seed]() { seed = seed * 1664525u + 1013904223u; return static_cast<unsigned char>(seed >> 24); };
        for (int i = 0; i < 2000; ++i) {
            Bytes junk(1 + (next() % 200));
            for (auto& b : junk) b = next();
            (void)si_dmi_filter_memory_records(junk.data(), junk.size(), filtered);
        }
        CHECK(true);
    }

    // ---------------------------------------------------------------
    // Snapshot encode / decode
    // ---------------------------------------------------------------
    {
        Bytes snap;
        si_snapshot_encode("boot-aaaa", table, snap);
        Bytes out;
        CHECK(snap.size() == 64 + table.size());
        CHECK(si_snapshot_decode(snap.data(), snap.size(), "boot-aaaa", out) == SI_SNAP_OK);
        CHECK(out == table);

        // Taken on an earlier boot => refused, never shown as current.
        CHECK(si_snapshot_decode(snap.data(), snap.size(), "boot-bbbb", out) == SI_SNAP_STALE);
        CHECK(out.empty());
        // Running boot id unknown => cannot judge staleness, accepted.
        CHECK(si_snapshot_decode(snap.data(), snap.size(), "", out) == SI_SNAP_OK);

        // Corruption.
        Bytes bad = snap; bad[0] = 'X';
        CHECK(si_snapshot_decode(bad.data(), bad.size(), "boot-aaaa", out) == SI_SNAP_INVALID);
        CHECK(si_snapshot_decode(snap.data(), 63, "boot-aaaa", out) == SI_SNAP_INVALID);
        CHECK(si_snapshot_decode(snap.data(), snap.size() - 1, "boot-aaaa", out) == SI_SNAP_INVALID);   // length > data
        CHECK(si_snapshot_decode(nullptr, 100, "boot-aaaa", out) == SI_SNAP_INVALID);
        Bytes zero = snap; put32(zero, 56, 0);
        CHECK(si_snapshot_decode(zero.data(), zero.size(), "boot-aaaa", out) == SI_SNAP_INVALID);
        Bytes huge = snap; put32(huge, 56, 0xFFFFFFFFu);
        CHECK(si_snapshot_decode(huge.data(), huge.size(), "boot-aaaa", out) == SI_SNAP_INVALID);

        // A boot id longer than the field is truncated safely, not overflowed.
        Bytes longId;
        si_snapshot_encode(std::string(200, 'z'), table, longId);
        CHECK(longId.size() == 64 + table.size());
        CHECK(si_snapshot_decode(longId.data(), longId.size(), "", out) == SI_SNAP_OK);

        // Trailing bytes after the declared table are ignored.
        Bytes padded = snap; padded.insert(padded.end(), 9, 0xEE);
        CHECK(si_snapshot_decode(padded.data(), padded.size(), "boot-aaaa", out) == SI_SNAP_OK);
        CHECK(out == table);
    }

    // errno -> reason code
    CHECK(si_dmi_open_failure_reason(EACCES) == SI_DMI_PERMISSION);
    CHECK(si_dmi_open_failure_reason(EPERM) == SI_DMI_PERMISSION);
    CHECK(si_dmi_open_failure_reason(ENOENT) == SI_DMI_NOT_PRESENT);
    CHECK(si_dmi_open_failure_reason(ENOTDIR) == SI_DMI_NOT_PRESENT);
    CHECK(si_dmi_open_failure_reason(EIO) == SI_DMI_INVALID);

#ifndef _WIN32
    // ---------------------------------------------------------------
    // Root-side writer and the unprivileged read path (Linux)
    // ---------------------------------------------------------------
    {
        char dirTemplate[] = "/tmp/si-snapshot-test-XXXXXX";
        const char* dir = mkdtemp(dirTemplate);
        CHECK(dir != nullptr);
        const std::string base = dir ? dir : "/tmp";
        const std::string path = base + "/state/smbios-memory.bin";

        // A restrictive umask (077) must not make the snapshot unreadable to the app.
        const mode_t previousUmask = umask(077);

        // Writer: creates the folder, writes 0644, leaves no temp file.
        CHECK(si_snapshot_write_from_table(mixed, path.c_str()) == 1);
        struct stat st {};
        CHECK(stat(path.c_str(), &st) == 0);
        CHECK((st.st_mode & 0777) == 0644);                     // readable by the unprivileged app
        CHECK(stat((path + ".tmp").c_str(), &st) != 0);         // atomic rename: no leftover
        struct stat dirSt {};
        CHECK(stat((base + "/state").c_str(), &dirSt) == 0);
        CHECK((dirSt.st_mode & 0755) == 0755);

        // What was written is exactly the filtered table, privacy intact.
        Bytes onDisk; int err = 0;
        CHECK(si_read_whole_file(path.c_str(), onDisk, err));
        CHECK(!contains(onDisk, kSerial) && !contains(onDisk, kUuid));
        Bytes decoded;
        CHECK(si_snapshot_decode(onDisk.data(), onDisk.size(), si_current_boot_id(), decoded) == SI_SNAP_OK);
        CHECK(decoded == memoryTable);                          // exactly the filtered memory table

        umask(previousUmask);

        // Overwriting an existing snapshot works (service restarts every boot).
        CHECK(si_snapshot_write_from_table(mixed, path.c_str()) == 1);

        // A stale leftover .tmp (even a symlink planted there) must not be followed or break the write.
        CHECK(symlink("/tmp/si-should-not-be-created", (path + ".tmp").c_str()) == 0);
        CHECK(si_snapshot_write_from_table(mixed, path.c_str()) == 1);
        CHECK(access("/tmp/si-should-not-be-created", F_OK) != 0);

        // Failure codes.
        Bytes noMemory; append(noMemory, record(0, 0x18, {"BIOS"})); append(noMemory, record(127, 4, {}));
        CHECK(si_snapshot_write_from_table(noMemory, path.c_str()) == -3);
        CHECK(si_snapshot_write_from_table(mixed, "/proc/si-cannot-write-here/x.bin") == -4);

        // Reader: with the live firmware table unreadable (the normal unprivileged
        // case), the app falls back to the snapshot. If this machine lets us read the
        // live table, the snapshot is not consulted, so those checks are skipped.
        FILE* live = std::fopen(SI_LIVE_DMI_TABLE, "rb");
        const int liveErrno = live ? 0 : errno;
        if (live) std::fclose(live);

        if (!live) {
            setenv("SYSTEMINFO_SMBIOS_SNAPSHOT", path.c_str(), 1);
            Bytes viaSnapshot; int reason = -1;
            CHECK(si_dmi_load_table_ex(viaSnapshot, reason));
            CHECK(reason == SI_DMI_OK);
            CHECK(!viaSnapshot.empty());
            CHECK(si_get_memory_hardware_status() == 0);
            long long installed = -2, maxCap = -2, maxMod = -2; int modules = -2, slots = -2;
            CHECK(si_get_memory_hardware_summary(&installed, &modules, &slots, &maxCap, &maxMod) == 1);
            CHECK(modules == 1);
            CHECK(slots == 2);
            CHECK(installed == 4LL * 1024 * 1024 * 1024);
            char mf[64], pn[64], sn[64], lo[64], bk[64], ff[64], ty[64];
            long long cap = 0, sp = 0, cs = 0; int dw = 0, tw = 0, rk = 0, ec = 0;
            CHECK(si_get_memory_module(0, mf, 64, pn, 64, sn, 64, lo, 64, bk, 64, ff, 64, ty, 64,
                                       &cap, &sp, &cs, &dw, &tw, &rk, &ec) == 1);
            CHECK(std::string(sn) == "MODULE-SN-1");

            // Snapshot from another boot => status 3 and no data (never silently stale).
            Bytes old; si_snapshot_encode("some-other-boot-id", memoryTable, old);
            const std::string stalePath = base + "/stale.bin";
            FILE* f = std::fopen(stalePath.c_str(), "wb");
            if (f) { std::fwrite(old.data(), 1, old.size(), f); std::fclose(f); }
            setenv("SYSTEMINFO_SMBIOS_SNAPSHOT", stalePath.c_str(), 1);
            if (!si_current_boot_id().empty()) {
                CHECK(si_get_memory_hardware_status() == SI_DMI_STALE_SNAPSHOT);
                CHECK(si_get_memory_hardware_summary(&installed, &modules, &slots, &maxCap, &maxMod) == 0);
                CHECK(installed == -1 && modules == -1 && slots == -1);
            }

            // Garbage file => invalid, not a crash.
            const std::string junkPath = base + "/junk.bin";
            f = std::fopen(junkPath.c_str(), "wb");
            if (f) { std::fputs("this is not a snapshot at all, just some text padding.....................", f); std::fclose(f); }
            setenv("SYSTEMINFO_SMBIOS_SNAPSHOT", junkPath.c_str(), 1);
            CHECK(si_get_memory_hardware_status() == SI_DMI_INVALID);

            // No snapshot at all: the reason is why the live table was unreadable.
            setenv("SYSTEMINFO_SMBIOS_SNAPSHOT", (base + "/does-not-exist.bin").c_str(), 1);
            CHECK(si_get_memory_hardware_status() == si_dmi_open_failure_reason(liveErrno));
            CHECK(si_get_memory_hardware_status() != 0);

            unsetenv("SYSTEMINFO_SMBIOS_SNAPSHOT");
        } else {
            std::printf("note: live firmware table is readable here; snapshot read-path checks skipped\n");
        }

        // Cleanup
        unlink((path + ".tmp").c_str());
        unlink(path.c_str());
        unlink((base + "/stale.bin").c_str());
        unlink((base + "/junk.bin").c_str());
        rmdir((base + "/state").c_str());
        rmdir(base.c_str());
    }
#endif

    if (g_failures == 0) {
        std::printf("smbios_loader_test: all %d checks passed\n", g_checks);
        return 0;
    }
    std::printf("smbios_loader_test: %d of %d checks FAILED\n", g_failures, g_checks);
    return 1;
}
