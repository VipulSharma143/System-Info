#!/usr/bin/env python3
"""
test_mongo_insert.py

Second Phase 8 milestone: manually insert one document into a new
SystemMonitorDB.snapshots collection and read it back, proving the
document shape and DB/collection setup work before any app code
(SnapshotLogger.cs or analytics_service.py) touches Mongo.

Usage:
    export MONGO_URI="mongodb+srv://user:pass@cluster.../?appName=..."
    python3 test_mongo_insert.py
"""

import os
import sys
from datetime import datetime, timezone

from pymongo import MongoClient
from pymongo.server_api import ServerApi

uri = os.environ.get("MONGO_URI")
if not uri:
    print("[error] MONGO_URI not set.")
    sys.exit(1)

client = MongoClient(uri, server_api=ServerApi("1"))

db = client["SystemMonitorDB"]
collection = db["snapshots"]

test_doc = {
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "cpuUsedPercent": 12.3,
    "network": [
        {"iface": "test0", "rxKBps": 1.1, "txKBps": 2.2}
    ]
}

print("Inserting test document...")
result = collection.insert_one(test_doc)
print(f"Inserted with _id: {result.inserted_id}")

print("\nReading it back...")
found = collection.find_one({"_id": result.inserted_id})
print(found)

print(f"\nTotal documents in SystemMonitorDB.snapshots: {collection.count_documents({})}")
