# Building SystemInfo.exe and setup.exe on Windows

I can’t build the actual Windows `.exe` files from here because this environment is Linux and doesn’t have the Windows/MSVC toolchain. The source and scripts are ready though. The final step of creating the Windows binaries needs to be done on a Windows machine.

You only need two free tools to do it, and the actual process is pretty quick.

## Files you should have in the project root

Before building anything, make sure these files are next to `backend/`, `frontend/`, `native/`, and `analytics/`:

```text
setup.ps1
start-all.ps1
SystemInfo.iss
SystemInfo.ico
SystemInfo.exe    <- created in Step 1
```

## Why there are two executables

There are two different things here:

* **SystemInfo.exe** is the normal launcher. You double-click it and it starts the application by running `start-all.ps1` without showing a PowerShell window.
* **setup.exe** is the installer. It installs/copies the project, runs `setup.ps1` to prepare everything, creates the required shortcuts, and can launch SystemInfo when installation is finished.

## Step 1 - Create SystemInfo.exe

First install the `ps2exe` PowerShell module:

```powershell
Install-Module ps2exe -Scope CurrentUser
```

Then run:

```powershell
Invoke-ps2exe .\start-all.ps1 .\SystemInfo.exe -iconFile .\SystemInfo.ico -noConsole -title "SystemInfo"
```

The `-noConsole` option is important because it prevents a PowerShell console window from appearing when you launch the application normally.

You also need `SystemInfo.ico` in the project root before running the command.

If you already have a logo as a PNG, you can convert it to `.ico` using any PNG-to-ICO converter and use that file here.

After the command finishes, you should have:

```text
SystemInfo.exe
```

## Step 2 - Build setup.exe with Inno Setup

Install Inno Setup from the official website:

[Inno Setup Download](https://jrsoftware.org/isdl.php?utm_source=chatgpt.com)

Then make sure `SystemInfo.iss` is in the project root along with:

```text
setup.ps1
start-all.ps1
SystemInfo.exe
SystemInfo.ico
```

Open `SystemInfo.iss` with Inno Setup and compile it.

You can also right-click the `.iss` file and choose **Compile**.

The installer should be created under:

```text
Output\SystemInfo-Setup.exe
```

If you want the installer to be called exactly:

```text
setup.exe
```

you can rename it after the build.

When the installer runs, it will copy the project files, run `setup.ps1`, install/prepare the required dependencies, build the native part, create the local data directory, and create a **SystemInfo** shortcut in the Start Menu. It can also create a Desktop shortcut depending on the installer options.

## Things that still need to be checked on Windows

There are a few parts that I haven't been able to verify from this environment.

### Native C++ engine

The Windows build of the native engine still needs to be tested.

`setup.ps1` uses CMake and MSVC to build it, but if any of the files under:

```text
native/src/
```

contain Linux-specific code such as:

```text
/proc
/sys/class/hwmon
/sys/class/drm
/sys/class/power_supply
```

without a proper Windows implementation or `#ifdef __linux__` handling, the Windows build will fail.

That isn't something the installer should hide. The native code itself needs to support Windows properly.

### Assembly benchmark

The Assembly benchmark may also be Linux-specific.

If the `.asm` code uses the System V AMD64 calling convention, it won't work the same way on Windows. Windows x64 uses a different calling convention, including different argument registers and the required shadow space.

If the benchmark is actually used by the native engine on Windows, the assembly code will need to be adjusted for the Windows x64 ABI.

### Windows battery information

`WindowsSystemInfoProvider.GetBattery()` is currently still a stub according to `PROJECT_STATUS.md`.

So the installer isn't the problem here. The Windows battery implementation itself still needs to be completed if you want real battery information on Windows.

## Before creating the installer

I would test `setup.ps1` directly on the Windows machine first:

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

This is worth doing before compiling `setup.exe`.

If the native build step fails there, fix that first. There's no point putting a broken setup process inside a shiny installer and then discovering it later. Humans have invented enough ways to make debugging harder already.

Once `setup.ps1` runs successfully, create `SystemInfo.exe` with `ps2exe`, compile `SystemInfo.iss` with Inno Setup, and test the final `setup.exe`.
