; SystemInfo.iss — Inno Setup script
;
; ============================================================
; DEPRECATED as of the Tauri 2 migration (2.0.0). The production installer
; is now built by Tauri's own bundler (`npm run tauri build` in frontend/,
; target "nsis" in frontend/src-tauri/tauri.conf.json) and CI no longer
; invokes this script — see .github/workflows/release.yml's build-windows
; job, which now stages backend/analytics into
; frontend/src-tauri/resources/ and lets `tauri build` produce both the app
; and the installer in one step.
;
; Kept in the repo per the migration spec's "don't delete working files
; prematurely" rule, as a rollback reference and because it documents the
; exact production file layout the old launcher-based build assembled. Not
; wired into any build path. Delete once the Tauri NSIS installer has been
; through a few real releases.
; ============================================================
;
; Compiles into "SystemInfo-Setup.exe".
;
; IMPORTANT — this no longer packages the repository. It packages ONLY the
; production staging directory built by CI at packaging\app\ (see
; .github/workflows/build-windows-installer.yml). That directory contains:
;
;     packaging\app\SystemInfo.exe          (self-contained launcher)
;     packaging\app\SystemInfo.ico
;     packaging\app\backend\...             (self-contained .NET publish
;                                             output + systemmonitor_native.dll)
;     packaging\app\analytics\...           (PyInstaller-built analytics.exe)
;     packaging\app\backend\wwwroot\...     (React production build, already
;                                             embedded in the backend publish)
;
; It contains NO source code, no node_modules, no .git, no dev scripts, and
; requires no Node/npm/Python/pip/.NET SDK on the machine it's installed on.
;
; HOW TO BUILD (must be done on Windows — this can't be compiled from Linux):
;   1. Run the CI pipeline (or its steps locally) to produce packaging\app\
;   2. Install Inno Setup (free): https://jrsoftware.org/isdl.php
;   3. Right-click SystemInfo.iss -> "Compile" (or run ISCC.exe SystemInfo.iss)
;   4. Output lands in .\Output\SystemInfo-Setup.exe
;
; What it does when a user double-clicks the resulting installer:
;   - Copies packaging\app\ to Program Files (or wherever they choose)
;   - Creates a Start Menu + optional Desktop shortcut called "SystemInfo"
;   - That's it. No post-install script runs. SystemInfo.exe (the launcher)
;     starts the already-built backend and analytics executables itself.

#define MyAppName "SystemInfo"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "Vipul Sharma"
#define MyAppExeName "SystemInfo.exe"
#define StagingDir "packaging\app"

[Setup]
AppId={{A6E1F2B0-7C3D-4E5A-9B1C-000000000000}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=Output
OutputBaseFilename=SystemInfo-Setup
SetupIconFile={#StagingDir}\SystemInfo.ico
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
WizardStyle=modern
; Refuse to compile against a stale/missing staging directory rather than
; silently packaging an old build — this is the guardrail against the old
; "copy the whole repo" failure mode.
#if !FileExists(StagingDir + "\SystemInfo.exe")
  #error "packaging\app\SystemInfo.exe not found. Run the production build (see .github/workflows/build-windows-installer.yml) before compiling the installer."
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
; ONLY the production staging directory — nothing else in the repo.
Source: "{#StagingDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\SystemInfo.exe"; IconFilename: "{app}\SystemInfo.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\SystemInfo.exe"; IconFilename: "{app}\SystemInfo.ico"; Tasks: desktopicon

[Run]
; The installer only installs. No setup.ps1, no build step, no dependency
; installation happens here — SystemInfo.exe is already a fully self-contained
; production build.
Filename: "{app}\SystemInfo.exe"; Description: "Launch SystemInfo now"; Flags: postinstall nowait skipifsilent
