# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

### Added

### Changed

### Fixed

### Known Issues


## [1.0.2] - 2026-09-20

### Purpose

- Windows test release to verify whether the packaged application works correctly on Windows.
- This release is primarily intended for testing the Windows installer and runtime behavior.

### Known Issues

- The installer successfully installs the application.
- After installation, the SystemInfo executable currently fails to start.
- Further investigation is required to determine why the packaged executable does not launch correctly on Windows.


## [1.0.1] - 2026-09-13

### Added

- Initial Windows installer release.
- SystemInfo Windows application.
- Native C++ monitoring engine.
- .NET backend.
- Frontend dashboard.
- Python analytics service.
- Automated Windows installer build.

### Changed

- Added GitHub Actions Windows build pipeline.
- Added automatic Inno Setup installer generation.

### Fixed

- Fixed Windows-specific project configuration.
- Removed leftover unconditional `.so` reference from the `.csproj`.
- Improved CMake Visual Studio generator detection.

