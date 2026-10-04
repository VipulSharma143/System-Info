// smbios.h — internal declarations for the SMBIOS memory-table reader.
// Platform-neutral parsing lives in src/smbios/; the only platform-specific piece is where
// the raw table comes from (platform/<os>/smbios_source.cpp).
#pragma once

#include "../internal.h"

#include <cstddef>
#include <vector>

// =====================================================================
// Physical RAM / DIMM hardware information
// =====================================================================
//
// Linux source:
//
//   /sys/firmware/dmi/tables/DMI
//
// SMBIOS structures:
//
//   Type 16 = Physical Memory Array
//   Type 17 = Memory Device
//
// No dmidecode process is used.
//
// Unknown:
//
//   strings -> ""
//   numbers -> -1
//   unavailable enumeration -> return 0
//
// Empty Type 17 slots are not returned as installed modules.
// The total slot count comes from Type 16.
//


struct SiDmiMemoryArray {
    unsigned short handle = 0;

    long long maxCapacityBytes = -1;

    int slotCount = -1;

    int errorCorrection = -1;
};

struct SiDmiMemoryModule {
    unsigned short arrayHandle = 0;

    long long capacityBytes = -1;
    long long speedMTs = -1;
    long long configuredSpeedMTs = -1;

    int dataWidth = -1;
    int totalWidth = -1;
    int rank = -1;

    int formFactor = -1;
    int memoryType = -1;

    std::string manufacturer;
    std::string partNumber;
    std::string serialNumber;
    std::string locator;
    std::string bankLocator;
};

enum SiDmiReason {
    SI_DMI_OK = 0,
    SI_DMI_NOT_PRESENT = 1,        // no table on this system (many VMs, some ARM boards)
    SI_DMI_PERMISSION = 2,         // table exists but this user may not read it
    SI_DMI_STALE_SNAPSHOT = 3,     // saved snapshot is from an earlier boot
    SI_DMI_INVALID = 4             // present but unreadable / not SMBIOS
};

static const size_t SI_SNAP_HEADER = 64;
static const size_t SI_SNAP_BOOTID = 40;
static const char SI_SNAP_MAGIC[16] = {
    'S', 'I', '-', 'S', 'M', 'B', 'I', 'O', 'S', '-', 'M', 'E', 'M', '-', '0', '1'
};

enum SiSnapshotStatus {
    SI_SNAP_OK = 0,
    SI_SNAP_INVALID = 1,
    SI_SNAP_STALE = 2
};

unsigned short si_dmi_u16(const unsigned char* p);
unsigned int si_dmi_u32(const unsigned char* p);
unsigned long long si_dmi_u64(const unsigned char* p);
std::string si_dmi_string(const unsigned char* record, size_t recordSize, unsigned char stringIndex);
size_t si_dmi_record_size(const unsigned char* record, size_t remaining);
int si_dmi_open_failure_reason(int err);
bool si_dmi_extract_rsmb(const unsigned char* raw, size_t rawSize, std::vector<unsigned char>& table);
bool si_dmi_filter_memory_records(const unsigned char* data, size_t size, std::vector<unsigned char>& out);
void si_snapshot_encode(const std::string& bootId, const std::vector<unsigned char>& table, std::vector<unsigned char>& out);
int si_snapshot_decode(const unsigned char* data, size_t size, const std::string& currentBootId, std::vector<unsigned char>& table);
bool si_dmi_load_table_ex(std::vector<unsigned char>& table, int& reason);
bool si_dmi_load_table(std::vector<unsigned char>& table);
bool si_read_whole_file(const char* path, std::vector<unsigned char>& data, int& err);
std::string si_current_boot_id();
std::string si_snapshot_path();
int si_snapshot_write_from_table(const std::vector<unsigned char>& raw, const char* path);
long long si_dmi_size_to_bytes(unsigned short sizeField, unsigned int extendedSizeField);
std::string si_memory_form_factor(int value);
std::string si_memory_type(int value);
int si_dmi_ecc_value(int errorCorrection);
bool si_dmi_read_memory_devices(const unsigned char* data, size_t size, std::vector<SiDmiMemoryArray>& arrays, std::vector<SiDmiMemoryModule>& modules);
bool si_dmi_get_memory_module(const unsigned char* data, size_t size, int index, std::vector<SiDmiMemoryArray>& arrays, std::vector<SiDmiMemoryModule>& modules);
int si_memory_module_impl(const unsigned char* tbl, size_t len, int index, char* manufacturerOut, int manufacturerSize, char* partNumberOut, int partNumberSize, char* serialNumberOut, int serialNumberSize, char* locatorOut, int locatorSize, char* bankLocatorOut, int bankLocatorSize, char* formFactorOut, int formFactorSize, char* memoryTypeOut, int memoryTypeSize, long long* capacityBytesOut, long long* speedMTsOut, long long* configuredSpeedMTsOut, int* dataWidthOut, int* totalWidthOut, int* rankOut, int* eccOut);
int si_memory_hardware_summary_impl(const unsigned char* tbl, size_t len, long long* installedBytesOut, int* moduleCountOut, int* slotCountOut, long long* maxCapacityBytesOut, long long* maxModuleCapacityBytesOut);
