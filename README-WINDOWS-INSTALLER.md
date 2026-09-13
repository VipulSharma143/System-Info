# Building SystemInfo.exe and setup.exe on Windows

I can't compile a real Windows `.exe` from here — this sandbox is Linux and has
no MSVC/Windows toolchain. Everything below is real, runnable source; the last
mile (turning it into a binary with your icon) has to happen on your own
Windows machine, with two free tools. It's a five-minute step, not a big one.

**File layout before you compile anything** — put these five in your project
root, next to `backend/`, `frontend/`, `native/`, `analytics/`:
```
setup.ps1
start-all.ps1
SystemInfo.iss
SystemInfo.ico   <- generated for you, swap for your own logo anytime
SystemInfo.exe   <- doesn't exist yet, Step 1 below creates it
```

## What's actually needed, and why it's two files, not one

- **`SystemInfo.exe`** — the thing the icon launches every day. Just needs to
  run `start-all.ps1` without popping a visible PowerShell console.
- **`setup.exe`** — the one-time installer: copies the project, runs
  `setup.ps1` (prereqs, native build, deps, `MONGO_URI`), creates the
  `SystemInfo` shortcut.

## Step 1 — Turn start-all.ps1 into SystemInfo.exe

Install the free `ps2exe` PowerShell module, then run:

```powershell
Install-Module ps2exe -Scope CurrentUser
Invoke-ps2exe .\start-all.ps1 .\SystemInfo.exe -iconFile .\SystemInfo.ico -noConsole -title "SystemInfo"
```

`-noConsole` is what makes double-clicking the icon not flash a black window.
Put your own `.ico` file at `.\SystemInfo.ico` first (an online PNG-to-ICO
converter works fine if you only have a PNG logo).

## Step 2 — Compile setup.exe with Inno Setup

1. Install [Inno Setup](https://jrsoftware.org/isdl.php) (free).
2. Put `SystemInfo.iss` in your project root, alongside `setup.ps1`,
   `start-all.ps1`, `SystemInfo.exe` (from Step 1), and `SystemInfo.ico`.
3. Right-click `SystemInfo.iss` → **Compile**.
4. Output: `.\Output\SystemInfo-Setup.exe` — rename to `setup.exe` if you
   want that exact filename.

Running that installer: copies the project, runs `setup.ps1` automatically,
adds a **SystemInfo** shortcut to the Start Menu and (optionally) Desktop,
and offers to launch it immediately.

## What I did not — and could not — fix

- **The native C++ engine's Windows path is unverified.** `setup.ps1` builds
  it with CMake + MSVC, but if `native/src/*.cpp` has Linux-only code (reading
  `/proc`, `/sys/class/hwmon`, `/sys/class/drm`, `/sys/class/power_supply`
  without a `#ifdef __linux__` / Windows branch), the build will fail — by
  design, `setup.ps1` doesn't paper over that with a fake success.
- **The Assembly benchmark is very likely Linux-ABI-specific** (System V
  AMD64 calling convention). If it's called from the native engine on
  Windows, it needs rewriting for the Windows x64 calling convention
  (different argument registers, mandatory shadow space) — that's real
  engineering work I'd need the actual `.asm` source to do.
- **`WindowsSystemInfoProvider.GetBattery()`** is explicitly a stub per
  `PROJECT_STATUS.md` ("not yet implemented").

None of that is a packaging problem — it's application code I don't have in
this session (only your shell scripts and docs were uploaded). If you upload
`native/src/*.cpp`, the `.asm` files, and `WindowsSystemInfoProvider.cs`, I
can actually look at whether they'll build/run on Windows rather than
guessing, and fix what's broken.

## Quick sanity check before you compile anything

Run just `setup.ps1` by itself first (`powershell -ExecutionPolicy Bypass
-File setup.ps1`) on the target Windows machine. If Step 3 (native build)
fails, that's the real blocker — worth fixing before wrapping any of this in
an installer.
