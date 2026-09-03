#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def _atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: mark_published.py STATE.json")
    path = Path(sys.argv[1])
    data = json.loads(path.read_text(encoding="utf-8"))
    data["published_count"] = len(data.get("selected", []))
    data["last_published_at"] = datetime.now(timezone.utc).isoformat()
    _atomic_json(path, data)
    print(json.dumps({"published_count": data["published_count"]}))


if __name__ == "__main__":
    main()
