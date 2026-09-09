#!/usr/bin/env python3
"""
test_mongo_connection.py

One-time throwaway script to verify Atlas connectivity before writing any
real ingestion code. Reads the connection string from the MONGO_URI
environment variable so the password never appears in chat, terminal
history you might paste elsewhere, or this repo.

Usage:
    export MONGO_URI="mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/"
    python3 test_mongo_connection.py
"""

import os
import sys

try:
    from pymongo import MongoClient
except ImportError:
    print("pymongo not installed. Run: pip3 install pymongo --break-system-packages")
    sys.exit(1)

uri = os.environ.get("MONGO_URI")
if not uri:
    print("[error] MONGO_URI environment variable not set.")
    print('Run: export MONGO_URI="mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/"')
    sys.exit(1)

print("Connecting...")
try:
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    result = client.admin.command("ping")
    print(f"Connected successfully: {result}")

    # List existing databases, just to confirm we can see the cluster's
    # real state (this also proves read permissions work, not just auth).
    print("\nExisting databases on this cluster:")
    for db_name in client.list_database_names():
        print(f"  - {db_name}")

except Exception as e:
    print(f"[error] Connection failed: {e}")
    sys.exit(1)
