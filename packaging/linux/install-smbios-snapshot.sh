#!/usr/bin/env bash
# install-smbios-snapshot.sh — one-time setup so the RAM tab can show the
# physical memory modules on Linux without running the whole app as root.
#
#   sudo packaging/linux/install-smbios-snapshot.sh              # install
#   sudo packaging/linux/install-smbios-snapshot.sh --uninstall  # remove
#
# Why this is needed: Linux only lets root read the firmware table
# (/sys/firmware/dmi/tables/DMI), because it also holds the machine's serial
# number and UUID. This installs a tiny helper that, as root, saves ONLY the
# memory records (SMBIOS Type 16/17) to /var/lib/system-info/smbios-memory.bin,
# which the app can read. A systemd service refreshes it on every boot, so it
# never goes stale after a RAM change. It does not use dmidecode.

set -euo pipefail

INSTALL_DIR=/usr/local/lib/system-info
UNIT=system-info-smbios-snapshot.service
UNIT_PATH=/etc/systemd/system/$UNIT
SNAPSHOT=/var/lib/system-info/smbios-memory.bin

if [[ $EUID -ne 0 ]]; then
    echo "This needs administrator rights. Run:  sudo $0 $*" >&2
    exit 1
fi

have_systemd() { command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; }

if [[ "${1:-}" == "--uninstall" ]]; then
    if have_systemd; then
        systemctl disable --now "$UNIT" 2>/dev/null || true
        rm -f "$UNIT_PATH"
        systemctl daemon-reload
    fi
    rm -rf "$INSTALL_DIR" /var/lib/system-info
    echo "Removed the memory snapshot helper and its saved data."
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Find the helper + library: next to this script (installed package), or in the
# native build folder (a source checkout after native/build.sh).
HELPER=""
for dir in "$SCRIPT_DIR" "$ROOT/native/build"; do
    if [[ -x "$dir/si_smbios_snapshot" && -f "$dir/libsystemmonitor_native.so" ]]; then
        HELPER_DIR="$dir"; HELPER=1; break
    fi
done
if [[ -z "$HELPER" ]]; then
    echo "Could not find si_smbios_snapshot. Build the native library first:" >&2
    echo "    ./native/build.sh" >&2
    exit 1
fi

# Make sure the helper works BEFORE installing anything, so a failure leaves
# the system untouched. (This also saves the first snapshot.)
if ! "$HELPER_DIR/si_smbios_snapshot"; then
    echo "The helper could not save the memory snapshot (see the message above); nothing was installed." >&2
    exit 1
fi

install -d -m 0755 "$INSTALL_DIR"
install -m 0755 "$HELPER_DIR/si_smbios_snapshot" "$INSTALL_DIR/si_smbios_snapshot"
install -m 0644 "$HELPER_DIR/libsystemmonitor_native.so" "$INSTALL_DIR/libsystemmonitor_native.so"

if have_systemd; then
    cat > "$UNIT_PATH" <<UNITEOF
[Unit]
Description=Save memory module details for System Info
After=local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$INSTALL_DIR/si_smbios_snapshot
StateDirectory=system-info
StateDirectoryMode=0755
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateNetwork=yes

[Install]
WantedBy=multi-user.target
UNITEOF
    systemctl daemon-reload
    systemctl enable --now "$UNIT"
    echo "Installed. The snapshot refreshes automatically at every boot."
else
    echo "systemd was not found, so the snapshot will not refresh by itself."
    echo "Run this again after changing RAM and restarting:  sudo $0"
fi

echo "Saved: $SNAPSHOT"
echo "Now restart the System Info backend and open the RAM tab."
