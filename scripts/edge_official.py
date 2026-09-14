"""Read-only official preview/result parsing with race and roster checks."""
from __future__ import annotations

import hashlib
import re
import unicodedata
import urllib.request
import urllib.error
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

from bs4 import BeautifulSoup


def clean(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value)))


def number(value):
    value = clean(value)
    if not re.fullmatch(r"-?(?:\d+(?:\.\d*)?|\.\d+)", value):
        raise ValueError("Official numeric field missing")
    return float(value)


def page(race, kind):
    url = (f"https://www.boatrace.jp/owpc/pc/race/{kind}?hd={race['race_date'].replace('-', '')}"
           f"&jcd={int(race['venue_code']):02d}&rno={int(race['race_no'])}")
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 FuneNoKotowari/2.1"})
    # Exhibition is sampled once per phase: retry transient transport failures
    # before recording that phase. Results already retry on the next watcher tick.
    attempts = 2 if kind == "beforeinfo" else 1
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                body = response.read()
            break
        except urllib.error.HTTPError:
            raise
        except (TimeoutError, urllib.error.URLError):
            if attempt + 1 == attempts:
                raise
    return body.decode("utf-8"), {"url": url, "obtained_at": datetime.now(timezone.utc).isoformat(),
                                   "sha256": hashlib.sha256(body).hexdigest()}


def document(html, race, kind):
    soup = BeautifulSoup(html, "html.parser")
    matches = []
    for th in soup.select("thead th"):
        a = th.find("a", href=True)
        if not a or th.get("class"):
            continue
        url = urlparse(a["href"]); query = parse_qs(url.query)
        if (url.path == f"/owpc/pc/race/{kind}" and query.get("hd") == [race["race_date"].replace("-", "")]
                and query.get("jcd") == [f"{int(race['venue_code']):02d}"]
                and query.get("rno") in ([str(race["race_no"])], [f"{int(race['race_no']):02d}"])):
            matches.append(th)
    if len(matches) != 1:
        raise ValueError("Official race identity does not match")
    return soup


def check_roster(actual, race):
    expected = {int(x["lane_no"]): str(x["racer_id"]) for x in race.get("roster", [])}
    if set(actual) != set(range(1, 7)) or len(expected) != 6 or actual != expected:
        raise ValueError("Official six-racer roster does not match")


def parse_preview(html, race, evidence):
    soup = document(html, race, "beforeinfo")
    tables = [t for t in soup.select("table") if t.find("thead") and "調整重量" in clean(t.find("thead").get_text())]
    if len(tables) != 1:
        raise ValueError("Exhibition table missing")
    common = {"レースコード": race["race_id"].replace("BR:", "").replace(":", ""),
              "レース日": race["race_date"], "レース場": int(race["venue_code"]),
              "レース回": f"{int(race['race_no']):02d}R", "締切時刻": race["start_time_jst"],
              "取得日時": evidence["obtained_at"]}
    tkz, stt, sui = dict(common, 状態=1), dict(common), dict(common)
    roster = {}
    for body in tables[0].find_all("tbody", recursive=False):
        rows = body.find_all("tr", recursive=False)
        if len(rows) != 4:
            raise ValueError("Exhibition row incomplete")
        cells = rows[0].find_all("td", recursive=False)
        lane = int(clean(cells[0].get_text()))
        racer = parse_qs(urlparse(cells[1].find("a")["href"]).query).get("toban", [""])[0]
        if lane in roster:
            raise ValueError("Duplicate exhibition lane")
        roster[lane] = racer
        tkz[f"艇{lane}_体重(kg)"] = number(cells[3].get_text().replace("kg", ""))
        tkz[f"艇{lane}_体重調整(kg)"] = number(rows[2].find("td").get_text())
        tkz[f"艇{lane}_展示タイム"] = number(cells[4].get_text())
        tkz[f"艇{lane}_チルト"] = number(cells[5].get_text())
        if not 4 < tkz[f"艇{lane}_展示タイム"] < 10:
            raise ValueError("Exhibition time outside valid range")
    check_roster(roster, race)
    starts = soup.select(".table1_boatImage1")
    lanes = []
    for course, start in enumerate(starts, 1):
        lane = int(clean(start.select_one(".table1_boatImage1Number").get_text()))
        value = clean(start.select_one(".table1_boatImage1Time").get_text())
        st = -number(value[1:]) if value.startswith("F") else number(value)
        stt[f"艇{lane}_コース"], stt[f"艇{lane}_スタート展示"] = course, st
        lanes.append(lane)
    if sorted(lanes) != list(range(1, 7)):
        raise ValueError("Start exhibition incomplete")
    weather = soup.select_one(".weather1")
    if weather is None:
        raise ValueError("Weather missing")
    for selector, key, suffix in [(".is-direction", "気温(℃)", "℃"), (".is-wind", "風速(m)", "m"),
                                  (".is-waterTemperature", "水温(℃)", "℃"), (".is-wave", "波の高さ(cm)", "cm")]:
        element = weather.select_one(selector + " .weather1_bodyUnitLabelData")
        if element is None:
            raise ValueError("Weather field missing")
        sui[key] = number(element.get_text().replace(suffix, ""))
    for selector, pattern, key in [(".is-windDirection p", r"is-wind(\d+)", "風向"),
                                    (".is-weather p", r"is-weather(\d+)", "天候")]:
        element = weather.select_one(selector)
        match = re.search(pattern, " ".join(element.get("class", []))) if element else None
        if not match:
            raise ValueError("Weather code missing")
        sui[key] = int(match.group(1))
    sui["気象観測時刻"] = None  # The page may say only "previous race"; never invent a time.
    return {"tkz": tkz, "stt": stt, "sui": sui, "evidence": evidence}


def fetch_preview(race):
    html, evidence = page(race, "beforeinfo")
    return parse_preview(html, race, evidence)


def parse_result(html, race, evidence):
    soup = document(html, race, "raceresult")
    def table_with(title):
        found = [t for t in soup.select("table") if t.find("thead") and clean(t.find("thead").get_text()) == title]
        if len(found) != 1:
            raise ValueError("Official result table missing")
        return found[0]
    table = table_with("着枠ボートレーサーレースタイム")
    finishers, roster = [], {}
    for row in table.select("tbody tr"):
        cells = row.find_all("td", recursive=False)
        position = clean(cells[0].get_text()); lane = int(clean(cells[1].get_text()))
        racer = clean(cells[2].select_one(".is-fs12").get_text())
        if lane in roster:
            raise ValueError("Duplicate finisher")
        roster[lane] = racer
        if position not in ["1", "2", "3", "4", "5", "6", "F", "L", "欠", "転", "落", "沈", "不", "失", "妨", "エ"]:
            raise ValueError("Unknown official finishing code")
        finishers.append({"lane_no": lane, "racer_id": racer,
                          "finish_position": int(position) if position.isdigit() else None,
                          "result_code": None if position.isdigit() else position})
    check_roster(roster, race)
    refund_text = clean(table_with("返還").find("tbody").get_text())
    if refund_text and not re.fullmatch("[1-6]+", refund_text):
        raise ValueError("Unknown refund notation")
    refunds = sorted({int(x) for x in refund_text})
    bodies = [b for b in soup.select("tbody") if any(clean(t.get_text()) == "3連単" for t in b.find_all("td"))]
    if len(bodies) != 1:
        raise ValueError("Trifecta payout missing")
    combos = [clean(e.get_text()) for e in bodies[0].select(".numberSet1_number")]
    payouts = [clean(e.get_text()) for e in bodies[0].select(".is-payout1") if clean(e.get_text())]
    if len(combos) != 3 or len(payouts) != 1 or not re.fullmatch(r"[¥￥][\d,]+", payouts[0]):
        raise ValueError("Missing or multiple trifecta payouts; archive reconciliation required")
    placed = sorted([f for f in finishers if f["finish_position"]], key=lambda f: f["finish_position"])
    if ([f["finish_position"] for f in placed[:3]] != [1, 2, 3]
            or combos != [str(f["lane_no"]) for f in placed[:3]]):
        raise ValueError("Winning order does not match payout")
    return {"race_id": race["race_id"], "combination": "-".join(combos),
            "payout_per_100_yen": int(re.sub(r"\D", "", payouts[0])), "refunded_lanes": refunds,
            "finishers": finishers, "evidence": evidence}


def fetch_result(race):
    html, evidence = page(race, "raceresult")
    return parse_result(html, race, evidence)


def archive_result(race_id, result, evidence):
    refunds = [f["lane_no"] for f in result.get("finishers", [])
               if (f.get("result_code") or "").startswith(("F", "L")) or f.get("result_code") == "K0"]
    if "combination" not in result and len(refunds) < 4:
        return None
    return {"race_id": race_id, "combination": result.get("combination", ""),
            "payout_per_100_yen": result.get("payout_per_100_yen", 0), "refunded_lanes": refunds,
            "cancelled": "combination" not in result, "finishers": result.get("finishers", []), "evidence": evidence}
