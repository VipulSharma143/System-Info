# Getting a real setup.exe without owning a Windows machine

This uses GitHub's free Windows build servers to compile everything for you.
You never touch a Windows PC — GitHub does, and hands you back the finished file.

## One-time setup

1. If your project isn't already a GitHub repo, push it to one (public or
   private — this works either way; private repos still get free Actions
   minutes on personal accounts, with a monthly cap).
2. Put `build-windows-installer.yml` at this exact path in your repo:
   `.github/workflows/build-windows-installer.yml`
3. Make sure `setup.ps1`, `start-all.ps1`, `SystemInfo.iss`, and `SystemInfo.ico`
   are committed at the repo root (same place you just moved them to).
4. Commit and push.

## Running it

1. On GitHub.com, open your repo → the **Actions** tab.
2. Click **build-windows-installer** in the left sidebar → **Run workflow** button.
3. Wait — this actually compiles your native C++/NASM, .NET, and frontend
   code on a real Windows machine, so expect several minutes, not seconds.
4. When it finishes (green checkmark), open that run → scroll to
   **Artifacts** at the bottom → download **SystemInfo-Setup**.
5. Unzip it — inside is `SystemInfo-Setup.exe`. That's your real, compiled
   Windows installer. Rename it to `setup.exe` if you want that exact name.

## If the run fails (red X)

Click the failed run → click the failed step → read the actual error in the
log, same as reading `logs/backend.log` locally. Paste that error here and
I'll fix it the same way I've been fixing the Linux build issues — against
the real error, not a guess.

## Why this is worth doing over guessing locally

Every fix so far in this conversation only got confirmed once you actually
ran the command and pasted real output — the CMakeLists.txt regression, the
missing `mkdir -p build`, the orphaned process on port 5132. This workflow
gives you that same "run it for real, see the real error" loop, but on
actual Windows, without needing your own Windows install.
