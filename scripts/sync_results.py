#!/usr/bin/env python3
"""Fetch one official BOAT RACE service day and send a signed ingest payload."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

from build_fixture import (
    JST,
    SELECTION_THRESHOLD,
    canonical_hash,
    fetch_artifact,
    make_prediction,
    parse_program,
    parse_results,
    score_race,
)


def serialize_artifact(artifact: Any) -> dict[str, Any]:
    return {
        "kind": artifact.kind,
        "date": artifact.date,
        "url": artifact.url,
        "fetched_at": artifact.fetched_at,
        "content_sha256": artifact.content_sha256,
        "byte_length": artifact.byte_length,
    }


def build_payload(service_date: str, *, include_legacy_predictions: bool = True) -> dict[str, Any]:
    program_artifact = fetch_artifact("B", service_date)
    races = parse_program(program_artifact)
    now = datetime.now(timezone.utc).replace(microsecond=0)

    decisions = []
    predictions = []
    for race in races:
        score, reasons = score_race(race)
        decision = "recommend" if score >= SELECTION_THRESHOLD else "skip"
        decisions.append({"race_id": race["race_id"], "score": score, "decision": decision, "reasons": reasons})
        start_at = datetime.fromisoformat(race["start_at"])
        if include_legacy_predictions and decision == "recommend" and start_at > now + timedelta(hours=2) and start_at.astimezone(JST).hour >= 18:
            prediction = make_prediction(race, now.isoformat(), replay=False)
            prediction["publication_mode"] = "forward_observation_poc"
            prediction.pop("publication_hash", None)
            prediction["publication_hash"] = canonical_hash(prediction)
            predictions.append(prediction)
    predictions.sort(key=lambda item: (-item["selection_score"], next(race["start_at"] for race in races if race["race_id"] == item["race_id"])))
    predictions = predictions[:3]

    artifacts = [program_artifact]
    results = []
    try:
        result_artifact = fetch_artifact("K", service_date)
        artifacts.append(result_artifact)
        parsed_results = parse_results(result_artifact)
        results = [{"race_id": race_id, **result} for race_id, result in parsed_results.items() if "combination" in result]
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise

    return {
        "schema_version": "boat-race-edge-ingest/v1",
        "generated_at": now.isoformat(),
        "service_date": service_date,
        "artifacts": [serialize_artifact(artifact) for artifact in artifacts],
        "races": races,
        "decisions": decisions,
        "predictions": predictions,
        "results": results,
    }


def send_payload(endpoint: str, secret: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))
    nonce = secrets.token_hex(16)
    signed = timestamp.encode() + b"." + nonce.encode() + b"." + body
    signature = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "BoatRaceEdgeSync/0.2",
            "X-Edge-Timestamp": timestamp,
            "X-Edge-Nonce": nonce,
            "X-Edge-Signature": signature,
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="service date in YYYY-MM-DD; defaults to today in JST")
    parser.add_argument("--endpoint", default=os.environ.get("EDGE_SITE_INGEST_ENDPOINT"))
    parser.add_argument("--no-legacy-predictions", action="store_true", help="sync programs/results without provisional predictions")
    args = parser.parse_args()
    secret = os.environ.get("EDGE_SITE_INGEST_SECRET")
    if not args.endpoint or not secret:
        raise SystemExit("EDGE_SITE_INGEST_ENDPOINT and EDGE_SITE_INGEST_SECRET are required")
    service_date = args.date or datetime.now(JST).date().isoformat()
    payload = build_payload(service_date, include_legacy_predictions=not args.no_legacy_predictions)
    result = send_payload(args.endpoint, secret, payload)
    print(json.dumps({"date": service_date, **result}, ensure_ascii=False))
    if result.get("status") not in {"complete", "duplicate"}:
        sys.exit(1)


if __name__ == "__main__":
    main()
