"""Read the public BOATCAST program in the CSV layout used by the frozen model."""
import csv
import json
import re
import time
import unicodedata
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from scripts import prepare_forward as program

BASE = "https://race.boatcast.jp"
META = ["レースコード", "レース日", "レース場コード", "レース回"]
PROFILE = ("登録番号 選手名 期別 支部 出身地 年齢 級別 賞除 F本数 L本数 全国平均ST 全国勝率 全国2連対率 全国3連対率 "
           "当地勝率 当地2連対率 当地3連対率 モーターフラグ モーター番号 モーター2連対率 モーター3連対率 "
           "ボートフラグ ボート番号 ボート2連対率 ボート3連対率 早見").split()
SESSIONS = [f"節D{day}走{run}_{field}" for day in range(1, 8) for run in (1, 2)
            for field in ("R番号", "進入", "枠", "ST", "着順")]
COLUMNS = META + [f"艇{lane}_{field}" for lane in range(1, 7) for field in PROFILE + SESSIONS]


def read(path):
    request = urllib.request.Request(BASE + path, headers={"User-Agent": "BoatRaceEdgeForward/2"})
    with urllib.request.urlopen(request, timeout=15) as response:
        data = response.read(512001)
    if len(data) > 512000:
        raise ValueError("Oversized BOATCAST response")
    return data.decode("utf-8-sig")


def titles(date):
    stamp = date.replace("-", "")
    payload = json.loads(read(f"/api_txt/getHoldingList2_{stamp}.json"))
    if payload["res_cd"] != 0:
        raise ValueError("BOATCAST program unavailable")
    rows = []
    for venue in payload["return_info"]:
        jo = venue["RaceStudiumNo"]
        if not re.fullmatch(r"[0-9]{2}", jo) or int(jo) not in program.VENUES:
            raise ValueError("Invalid BOATCAST venue")
        races = zip(venue["RaceTitleAll"], venue["DeadlineTimeAll"], venue["CancelStatusAll"], strict=True)
        for number, (name, clock, cancelled) in enumerate(races, 1):
            if cancelled or not re.fullmatch(r"[0-9]{1,2}:[0-9]{2}", clock.strip()):
                continue
            clock = datetime.strptime(clock.strip(), "%H:%M").strftime("%H:%M")
            if number > 12:
                raise ValueError("Invalid BOATCAST race number")
            rows.append(dict(zip(META, [stamp + jo + f"{number:02}", date, jo, f"{number:02}R"]),
                             レース場=program.VENUES[int(jo)], タイトル=venue["HoldingTitle"], 日次=venue["DailyTitle"],
                             グレード=venue["RaceGrade"], ナイター=venue["NighterFlag"], レース名=name.strip(),
                             電話投票締切予定=clock, 中止状態=cancelled))
    return rows


def card(title):
    code = title["レースコード"]
    lines = read(f"/hp_txt/{code[8:10]}/bc_j_str3_{code[:8]}_{code[8:10]}_{code[10:]}.txt").splitlines()
    if len(lines) < 2 or lines[0] != "data=":
        raise ValueError("Invalid BOATCAST race card")
    if lines[1].split("\t")[0] == "2":
        return None
    boats = lines[2:8]
    if len(boats) != 6:
        return None
    row = {key: title[key] for key in META}
    ids = set()
    for lane, boat in enumerate(boats, 1):
        cells = [unicodedata.normalize("NFKC", cell).strip() for cell in boat.split("\t")]
        if len(cells) < 39 or not re.fullmatch(r"[0-9]{4}", cells[0]) or cells[0] in ids:
            return None
        ids.add(cells[0])
        branch, _, birthplace = cells[3].replace(" ", "").partition(":")
        profile = cells[:3] + [branch, birthplace] + cells[4:25]
        for idx, marker in ((8, "F"), (9, "L")):
            value = profile[idx]
            profile[idx] = "0" if not value else ("1" if value == marker else value.removeprefix(marker))
        profile[-1] = profile[-1].removesuffix("R")
        sessions = []
        for value in cells[25:39]:
            parts = value.split(",")
            sessions.extend(parts if len(parts) == 5 else [""] * 5)
        for key, value in zip(PROFILE + SESSIONS, profile + sessions, strict=True):
            row[f"艇{lane}_{key}"] = "" if value == "-" else value
    return row


def write(path, fields, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    with temp.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    temp.replace(path)


def refresh(root, date):
    path = program._day_path(root, "programs/race_cards", date)
    if path.exists() and time.time() - path.stat().st_mtime < 300:
        return root
    schedule = titles(date)
    title_path = program._day_path(root, "programs/title", date)
    old = {}
    if path.exists():
        with path.open(encoding="utf-8", newline="") as handle:
            old = {r["レースコード"]: r for r in csv.DictReader(handle)}
    now = datetime.now(program.JST)
    def get(title):
        key = title["レースコード"]
        deadline = datetime.fromisoformat(date + "T" + title["電話投票締切予定"]).replace(tzinfo=program.JST)
        if key in old and not 0 < (deadline-now).total_seconds() < 40*60:
            return old[key]
        try:
            return card(title)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            return None
    with ThreadPoolExecutor(max_workers=4) as pool:
        cards = [row for row in pool.map(get, schedule) if row]
    # The live schedule replaces elapsed deadlines with "確定". Keep those
    # previously observed rows available to the frozen loader and settlement.
    if title_path.exists():
        active = {title["レースコード"] for title in schedule}
        with title_path.open(encoding="utf-8", newline="") as handle:
            for previous in csv.DictReader(handle):
                key = previous["レースコード"]
                deadline = datetime.fromisoformat(date + "T" + previous["電話投票締切予定"]).replace(tzinfo=program.JST)
                if key in old and key not in active and deadline <= now:
                    schedule.append(previous)
                    cards.append(old[key])
    if schedule:
        write(title_path, list(schedule[0]), schedule)
    write(path, COLUMNS, cards)
    return root
