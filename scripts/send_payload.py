#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.request
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: send_payload.py PAYLOAD.json")
    endpoint = os.environ.get("EDGE_SITE_INGEST_ENDPOINT")
    secret = os.environ.get("EDGE_SITE_INGEST_SECRET")
    if not endpoint or not secret:
        raise RuntimeError("Missing site ingestion configuration")
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    body = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    timestamp = str(int(time.time()))
    nonce = secrets.token_hex(16)
    signature = hmac.new(
        secret.encode("utf-8"),
        timestamp.encode() + b"." + nonce.encode() + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Edge-Timestamp": timestamp,
            "X-Edge-Nonce": nonce,
            "X-Edge-Signature": signature,
            "User-Agent": "BoatRaceEdgeForwardRunner/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        text = response.read().decode("utf-8")
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"Ingestion failed: {response.status} {text}")
        print(text)
        if json.loads(text).get("rejected_reassessments", 0):
            raise RuntimeError("Some exhibition assessments were rejected; do not mark them published")


if __name__ == "__main__":
    main()
