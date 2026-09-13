; SystemInfo.iss — Inno Setup script
;
; Compiles into "SystemInfo-Setup.exe" (rename the OutputBaseFilename below to
; just "setup" if you want the literal filename "setup.exe").
;
; HOW TO BUILD (must be done on Windows — this can't be compiled from Linux):
;   1. Install Inno Setup (free): https://jrsoftware.org/isdl.php
;   2. Put this .iss file directly in your project root — the SAME folder as
;      setup.ps1, start-all.ps1, backend/, frontend/, native/, analytics/
;      (it copies with Source: ".\*", i.e. "everything next to me")
;   3. Put SystemInfo.exe (built via ps2exe, see README-WINDOWS-INSTALLER.md)
;      and SystemInfo.ico in that same project root
;   4. Right-click SystemInfo.iss -> "Compile" (or run ISCC.exe SystemInfo.iss)
;   5. Output lands in .\Output\SystemInfo-Setup.exe
;
; What it does when a user double-clicks the resulting installer:
;   - Copies the whole project to Program Files (or wherever they choose)
;   - Creates a Start Menu + optional Desktop shortcut called "SystemInfo"
;     that runs start-all.ps1 with your icon
;   - Runs setup.ps1 automatically at the end of install (prerequisite
;     check/install, native build, dependency install, MONGO_URI prompt)

#define MyAppName "SystemInfo"
#define MyAppVersion "1.0"
#define MyAppExeName "SystemInfo.exe"

[Setup]
AppId={{A6E1F2B0-7C3D-4E5A-9B1C-000000000000}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=Output
OutputBaseFilename=SystemInfo-Setup
SetupIconFile=SystemInfo.ico
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
; This .iss file lives in the project root (alongside setup.ps1, start-all.ps1,
; SystemInfo.exe, SystemInfo.ico) — so the source is ".\*", not "..\*".
; Copies everything except node_modules/bin/obj/build junk, git internals, and
; the installer's own build artifacts. *.ico is intentionally NOT excluded —
; the shortcut in [Icons] below needs it present in {app} after install.
Source: ".\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; \
    Excludes: "node_modules,bin,obj,dist,build,.git,logs,Output,*.iss"

[Icons]
; Start Menu + optional Desktop shortcut, both named "SystemInfo", running the
; launcher hidden-console via a tiny wrapper (see wrapper note below).
Name: "{group}\{#MyAppName}"; Filename: "{app}\SystemInfo.exe"; IconFilename: "{app}\SystemInfo.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\SystemInfo.exe"; IconFilename: "{app}\SystemInfo.ico"; Tasks: desktopicon

[Run]
; Runs setup.ps1 once, right after files are copied, before the wizard closes.
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup.ps1"""; \
    WorkingDir: "{app}"; \
    Flags: runascurrentuser waituntilterminated; \
    StatusMsg: "Running first-time setup (this can take several minutes)..."
Filename: "{app}\SystemInfo.exe"; Description: "Launch SystemInfo now"; Flags: postinstall nowait skipifsilent
