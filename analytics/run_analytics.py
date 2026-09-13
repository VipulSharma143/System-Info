#!/usr/bin/env python3
"""
run_analytics.py

Production entrypoint for the packaged analytics service.

This is the file PyInstaller freezes into analytics.exe. It is NOT used
in development — during development, run analytics_service.py directly
with `uvicorn analytics_service:app --reload` as documented there.

Why this exists separately from analytics_service.py:
  - PyInstaller needs a script with a concrete `if __name__ == "__main__"`
    entrypoint that calls uvicorn.run() in-process. The dev workflow
    (`uvicorn module:app` on the command line) relies on uvicorn locating
    and importing the module by name from disk, which does not work
    inside a frozen PyInstaller bundle.
  - Keeping this thin means analytics_service.py (the actual FastAPI app
    and business logic) is completely unaffected by packaging concerns.

Usage (production, called by the SystemInfo launcher):
    analytics.exe --port 8001

Usage (still works unfrozen, for testing the packaged entrypoint locally):
    python run_analytics.py --port 8001
"""

import argparse
import sys

import uvicorn

from analytics_service import app


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the System Info analytics service.")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, ws="none", log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
