#!/usr/bin/env python3
"""
Download Anime Expo 2026 schedule data and convert it to this app's convention format.

Default usage downloads the public schedule page, writes ax2026-source.json, and
then writes conventions/ax2026.json.

The raw source JSON is intended to be inspected with tools such as jq before and
after conversion.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError as exc:
    missing = exc.name or "requests/beautifulsoup4"
    print(
        f"Missing Python dependency: {missing}. Install with: "
        "python3 -m pip install requests beautifulsoup4",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc


SCHEDULE_URL = "https://www.anime-expo.org/ax/schedule-2026/"
SOURCE_PATH = Path("ax2026-source.json")
OUTPUT_PATH = Path("conventions/ax2026.json")
EXPECTED_DATES = {
    "July 2, 2026",
    "July 3, 2026",
    "July 4, 2026",
    "July 5, 2026",
}
TICKET_HOST_PATTERNS = (
    "showclix.com",
    "events.leapevents.com",
)


def normalize_space(value: str) -> str:
    value = value.replace("\u00a0", " ").replace("\u202f", " ")
    return re.sub(r"\s+", " ", value).strip()


def text_from_selector(event_node: Any, selector: str) -> str:
    found = event_node.select_one(selector)
    if not found:
        return ""
    return normalize_space(found.get_text(" ", strip=True))


def strip_label(value: str, label: str) -> str:
    return normalize_space(re.sub(rf"^{re.escape(label)}\s*:?\s*", "", value, flags=re.I))


def title_text(event_node: Any) -> str:
    title_node = event_node.select_one(".title .name-ticket") or event_node.select_one(".title")
    if not title_node:
        return ""

    title_copy = copy.copy(title_node)
    for ticket_node in title_copy.select(".ticket"):
        ticket_node.decompose()
    return normalize_space(title_copy.get_text(" ", strip=True))


def event_links(event_node: Any, base_url: str) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    for anchor in event_node.find_all("a"):
        href = normalize_space(anchor.get("href") or "")
        if not href:
            continue
        links.append({
            "text": normalize_space(anchor.get_text(" ", strip=True)),
            "href": urljoin(base_url, href),
        })
    return links


def has_ticket(event_node: Any, links: list[dict[str, str]]) -> bool:
    if event_node.select_one(".ticket"):
        return True
    return any(any(pattern in link["href"].lower() for pattern in TICKET_HOST_PATTERNS) for link in links)


def extract_events(html: str, source_url: str) -> tuple[list[dict[str, Any]], list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    event_nodes = soup.select(".ax-schedule .event") or soup.select(".event")
    events: list[dict[str, Any]] = []
    warnings: list[str] = []

    for source_index, event_node in enumerate(event_nodes, 1):
        links = event_links(event_node, source_url)
        date = text_from_selector(event_node, ".info .date") or text_from_selector(event_node, ".date")
        room = text_from_selector(event_node, ".channel .bold") or strip_label(text_from_selector(event_node, ".channel"), "Panel Room")
        start = text_from_selector(event_node, ".start .bold") or strip_label(text_from_selector(event_node, ".start"), "START")
        end = text_from_selector(event_node, ".end .bold") or strip_label(text_from_selector(event_node, ".end"), "END")
        description = text_from_selector(event_node, ".desc")

        event = {
            "sourceIndex": source_index,
            "date": date,
            "title": title_text(event_node),
            "panelRoom": room,
            "start": start,
            "end": end,
            "panelDescription": description,
            "ticket": has_ticket(event_node, links),
            "links": links,
        }
        missing_fields = [
            field_name
            for field_name in ("date", "title", "panelRoom", "start", "end", "panelDescription")
            if not event[field_name]
        ]
        if missing_fields:
            warnings.append(f"event {source_index} missing {', '.join(missing_fields)}")
        events.append(event)

    found_dates = {event["date"] for event in events if event["date"]}
    missing_dates = EXPECTED_DATES - found_dates
    unexpected_dates = found_dates - EXPECTED_DATES
    if missing_dates:
        warnings.append(f"missing expected dates: {', '.join(sorted(missing_dates))}")
    if unexpected_dates:
        warnings.append(f"unexpected dates: {', '.join(sorted(unexpected_dates))}")

    return events, warnings


def download_schedule(url: str) -> str:
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    }
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.text


def write_source_json(url: str, source_path: Path) -> dict[str, Any]:
    html = download_schedule(url)
    events, warnings = extract_events(html, url)
    raw_data = {
        "sourceUrl": url,
        "downloadedAt": datetime.now(timezone.utc).isoformat(),
        "eventCount": len(events),
        "events": events,
        "warnings": warnings,
    }
    source_path.write_text(json.dumps(raw_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return raw_data


def load_source_json(source_path: Path) -> dict[str, Any]:
    with source_path.open(encoding="utf-8") as source_file:
        return json.load(source_file)


def parse_date(date_text: str) -> datetime:
    return datetime.strptime(date_text, "%B %d, %Y")


def parse_time_minutes(time_text: str) -> int:
    match = re.fullmatch(r"(\d{1,2}):(\d{2})\s*([AP]M)", normalize_space(time_text), flags=re.I)
    if not match:
        raise ValueError(f"invalid time: {time_text!r}")
    hour = int(match.group(1))
    minute = int(match.group(2))
    meridiem = match.group(3).upper()
    if meridiem == "AM" and hour == 12:
        hour = 0
    elif meridiem == "PM" and hour != 12:
        hour += 12
    return hour * 60 + minute


def event_sort_key(event: dict[str, Any]) -> tuple[datetime, int, str, str]:
    return (
        parse_date(event["date"]),
        parse_time_minutes(event["start"]),
        event["panelRoom"].casefold(),
        event["title"].casefold(),
    )


def app_event(source_event: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": normalize_space(source_event.get("title", "")),
        "panelRoom": normalize_space(source_event.get("panelRoom", "")),
        "start": normalize_space(source_event.get("start", "")),
        "end": normalize_space(source_event.get("end", "")),
        "panelDescription": normalize_space(source_event.get("panelDescription", "")),
        "ticket": bool(source_event.get("ticket", False)),
        "date": normalize_space(source_event.get("date", "")),
    }


def convert_source(raw_data: dict[str, Any], output_path: Path) -> dict[str, Any]:
    required_fields = ("title", "panelRoom", "start", "end", "panelDescription", "date")
    converted_events: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen_events: set[tuple[Any, ...]] = set()

    for source_event in raw_data.get("events", []):
        event = app_event(source_event)
        missing_fields = [field_name for field_name in required_fields if not event[field_name]]
        if missing_fields:
            warnings.append(
                f"skipped sourceIndex={source_event.get('sourceIndex', '?')} "
                f"missing {', '.join(missing_fields)}"
            )
            continue

        event_identity = tuple(event[field_name] for field_name in (
            "title", "panelRoom", "start", "end", "panelDescription", "ticket", "date"
        ))
        if event_identity in seen_events:
            warnings.append(f"deduplicated sourceIndex={source_event.get('sourceIndex', '?')}")
            continue
        seen_events.add(event_identity)
        converted_events.append(event)

    converted_events.sort(key=event_sort_key)
    convention = {
        "name": "AX 2026",
        "startDate": "July 2, 2026",
        "endDate": "July 5, 2026",
        "events": converted_events,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(convention, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if warnings:
        print("Conversion warnings:", file=sys.stderr)
        for warning in warnings:
            print(f"  - {warning}", file=sys.stderr)

    return convention


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download and convert AX 2026 schedule data.")
    parser.add_argument("--url", default=SCHEDULE_URL, help="Anime Expo schedule page URL")
    parser.add_argument("--source", type=Path, default=SOURCE_PATH, help="raw extracted source JSON path")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH, help="converted convention JSON path")
    parser.add_argument("--download-only", action="store_true", help="only fetch and write the raw source JSON")
    parser.add_argument("--convert-only", action="store_true", help="only convert an existing raw source JSON")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.download_only and args.convert_only:
        print("Choose only one of --download-only or --convert-only.", file=sys.stderr)
        return 2

    if args.convert_only:
        raw_data = load_source_json(args.source)
    else:
        raw_data = write_source_json(args.url, args.source)
        print(f"Wrote {args.source} with {raw_data['eventCount']} extracted events")
        if raw_data.get("warnings"):
            print("Extraction warnings:", file=sys.stderr)
            for warning in raw_data["warnings"]:
                print(f"  - {warning}", file=sys.stderr)

    if args.download_only:
        return 0

    convention = convert_source(raw_data, args.output)
    print(f"Wrote {args.output} with {len(convention['events'])} converted events")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())