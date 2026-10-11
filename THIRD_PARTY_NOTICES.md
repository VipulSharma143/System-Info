# Third-party notices

## PawnIO (Windows CPU sensor driver)

The Windows installer ships the **unmodified, official PawnIO installer** (`PawnIO_setup.exe`, version 2.2.0, signed by its
author) next to the backend, as a separate program. System Info runs it once, silently, with administrator rights, so the CPU
temperature library can read processor sensors. System Info does not link PawnIO's code; it only starts that installer and
talks to the driver through the temperature library.

- Author: namazso · Home: <https://pawnio.eu> · Source: <https://github.com/namazso/PawnIO>
- License: GNU GPL v2 or later, with the author's additional exception for programs that communicate with PawnIO only through
  the device I/O control interface (full text in the project's `COPYING`).
- The installer is downloaded from the project's own GitHub release by `scripts/fetch-pawnio.mjs` and is refused unless its
  SHA-256 matches `1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032`.
- The driver stays installed if System Info is uninstalled (other programs may use it). Remove it from Windows
  "Installed apps" (PawnIO) if you do not want it.
- Set the environment variable `SYSTEMINFO_NO_DRIVER_INSTALL=1` to stop System Info installing it automatically.

## LibreHardwareMonitorLib

Reads Windows CPU temperatures. Mozilla Public License 2.0 — <https://github.com/LibreHardwareMonitor/LibreHardwareMonitor>
