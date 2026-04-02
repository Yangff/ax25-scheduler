#!/usr/bin/env python3
"""
Fix sakuracon2026.json by finding events in the source (sakuracon.json)
that were lost due to slot-key collisions in the conversion.

Specifically: when multiple events share the same room+date+start+end,
the conversion script's dict overwrote all but one. This script finds
those missing events and adds them back.
"""

import json
import re
import sys


def replace_non_latin(s: str) -> str:
    return re.sub(r'[^\u0000-\u007f]', '_', s)


def event_key(e: dict) -> str:
    title = replace_non_latin(e["title"])
    return f"{e['date']}|{e['panelRoom']}|{title}|{e['start']}"


def main():
    source_path = "sakuracon.json"
    target_path = "conventions/sakuracon2026.json"

    with open(source_path, encoding="utf-8") as f:
        source_data = json.load(f)

    with open(target_path, encoding="utf-8") as f:
        target_data = json.load(f)

    # Build set of event keys already in target
    target_keys = set()
    for e in target_data["events"]:
        target_keys.add(event_key(e))

    # Build all source events from all_sessions
    track_names_by_id = {}
    for track_id, track_data in source_data["list"].items():
        track_names_by_id[track_id] = track_data["track"]["title"].strip()

    missing = []
    seen_source = set()

    for sid, s in source_data["all_sessions"].items():
        title = s["title"].strip()
        track_id = s.get("track_id", "")
        track_name = track_names_by_id.get(track_id, s.get("track_name", "").strip())
        description = s.get("description", "")

        if description:
            panel_desc = f"[{track_name}] {description}"
        else:
            panel_desc = f"[{track_name}]"

        ev = {
            "title": title,
            "panelRoom": s["location"],
            "start": s["start_min"],
            "end": s["end_min"],
            "panelDescription": panel_desc,
            "ticket": False,
            "date": s["start_date"],
        }

        ek = event_key(ev)

        # Skip duplicates within source
        if ek in seen_source:
            continue
        seen_source.add(ek)

        # Find events in source but not in target
        if ek not in target_keys:
            missing.append(ev)

    if not missing:
        print("No missing events found!")
        return

    print(f"Found {len(missing)} missing events. Adding them...")
    for m in missing[:20]:
        print(f"  + {m['title']} | {m['panelRoom']} | {m['date']} {m['start']}-{m['end']}")
    if len(missing) > 20:
        print(f"  ... and {len(missing) - 20} more")

    # Add missing events
    target_data["events"].extend(missing)

    # Sort by date, start time, room
    months = {
        "January": 1, "February": 2, "March": 3, "April": 4,
        "May": 5, "June": 6, "July": 7, "August": 8,
        "September": 9, "October": 10, "November": 11, "December": 12
    }

    def parse_time_minutes(time_str):
        parts = time_str.strip().split()
        t = parts[0]
        ampm = parts[1].upper()
        h, m = map(int, t.split(":"))
        if ampm == "AM" and h == 12:
            h = 0
        elif ampm == "PM" and h != 12:
            h += 12
        return h * 60 + m

    def sort_key(e):
        parts = e["date"].split()
        month = months[parts[0]]
        day = int(parts[1].rstrip(","))
        year = int(parts[2])
        start_mins = parse_time_minutes(e["start"])
        return (year, month, day, start_mins, e["panelRoom"])

    target_data["events"].sort(key=sort_key)

    # Write back
    with open(target_path, "w", encoding="utf-8") as f:
        json.dump(target_data, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {len(target_data['events'])} total events to {target_path}")


if __name__ == "__main__":
    main()
