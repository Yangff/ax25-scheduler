#!/usr/bin/env python3
"""
Convert sakuracon.json (Sched API format) to conventions/sakuracon2026.new.json format.

Two modes:
  --check     Estimation mode: report all issues, no conversion.
  (default)   Interactive mode: ask user to resolve mismatches,
              produce output with _renameMap and _deletedEvents metadata.

Rename map uses event key format: "date|room|title|start"
matching the web app's getEventId().
"""

import json
import re
import sys
from collections import defaultdict


def replace_non_latin(s: str) -> str:
    """Replace non-Latin chars with underscore, matching JS getEventId."""
    return re.sub(r'[^\u0000-\u007f]', '_', s)


def event_key(e: dict) -> str:
    """Build event key matching the web app format: date|room|title|start"""
    title = replace_non_latin(e["title"])
    return f"{e['date']}|{e['panelRoom']}|{title}|{e['start']}"


def load_source(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    # Build track name lookup from list (has canonical track names)
    track_names_by_id = {}
    for track_id, track_data in data["list"].items():
        track_names_by_id[track_id] = track_data["track"]["title"].strip()

    # Use all_sessions as the authoritative source (list only has a subset)
    sessions = []
    for sid, s in data["all_sessions"].items():
        title = s["title"].strip()
        track_id = s.get("track_id", "")
        track_name = track_names_by_id.get(track_id, s.get("track_name", "").strip())
        description = s.get("description", "")

        if description:
            panel_desc = f"[{track_name}] {description}"
        else:
            panel_desc = f"[{track_name}]"

        sessions.append({
            "title": title,
            "panelRoom": s["location"],
            "start": s["start_min"],
            "end": s["end_min"],
            "panelDescription": panel_desc,
            "ticket": False,
            "date": s["start_date"],
            "_track_name": track_name,
        })

    return sessions


def load_existing(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def parse_time_minutes(time_str: str) -> int:
    parts = time_str.strip().split()
    t = parts[0]
    ampm = parts[1].upper()
    h, m = map(int, t.split(":"))
    if ampm == "AM":
        if h == 12:
            h = 0
    else:
        if h != 12:
            h += 12
    return h * 60 + m


def sort_key(e):
    parts = e["date"].split()
    month_name = parts[0]
    day = int(parts[1].rstrip(","))
    year = int(parts[2])
    months = {
        "January": 1, "February": 2, "March": 3, "April": 4,
        "May": 5, "June": 6, "July": 7, "August": 8,
        "September": 9, "October": 10, "November": 11, "December": 12
    }
    month = months[month_name]
    start_mins = parse_time_minutes(e["start"])
    return (year, month, day, start_mins, e["panelRoom"])


def ask_choice(prompt, options):
    print(f"\n{prompt}")
    for i, opt in enumerate(options, 1):
        print(f"  {i}. {opt}")
    while True:
        try:
            choice = int(input(f"Choose [1-{len(options)}]: "))
            if 1 <= choice <= len(options):
                return choice - 1
        except (ValueError, EOFError):
            pass
        print(f"  Please enter a number between 1 and {len(options)}.")


def fmt_event(e):
    return f"'{e['title']}' room={e['panelRoom']}, date={e['date']}, {e['start']}-{e['end']}"


def run(check_only: bool):
    source_path = "sakuracon.json"
    existing_path = "conventions/sakuracon2026.json"
    output_path = "conventions/sakuracon2026.new.json"

    source_sessions = load_source(source_path)
    existing_data = load_existing(existing_path)
    existing_events = existing_data["events"]

    errors = []
    warnings = []

    # ---------------------------------------------------------------
    # Build existing lookups
    # ---------------------------------------------------------------
    existing_by_slot = {}  # (room, date, start, end) -> event
    existing_by_key = {}   # event_key -> event
    for e in existing_events:
        slot = (e["panelRoom"], e["date"], e["start"], e["end"])
        if slot in existing_by_slot:
            warnings.append(
                f"DUPLICATE EXISTING SLOT: {fmt_event(e)} vs {fmt_event(existing_by_slot[slot])}"
            )
        existing_by_slot[slot] = e
        existing_by_key[event_key(e)] = e

    existing_rooms = set(e["panelRoom"] for e in existing_events)
    source_rooms = set(s["panelRoom"] for s in source_sessions)

    # ---------------------------------------------------------------
    # Room name checks
    # ---------------------------------------------------------------
    rooms_only_in_source = source_rooms - existing_rooms
    rooms_only_in_existing = existing_rooms - source_rooms

    if rooms_only_in_source or rooms_only_in_existing:
        if rooms_only_in_source:
            for r in sorted(rooms_only_in_source):
                warnings.append(f"ROOM ONLY IN SOURCE: '{r}'")
        if rooms_only_in_existing:
            for r in sorted(rooms_only_in_existing):
                warnings.append(f"ROOM ONLY IN EXISTING: '{r}'")

    # Room name map (identity for now; source rooms are authoritative)
    room_name_map = {loc: loc for loc in source_rooms}

    # ---------------------------------------------------------------
    # Deduplicate source
    # ---------------------------------------------------------------
    seen_dedup = set()
    source_unique = []
    for s in source_sessions:
        room = room_name_map.get(s["panelRoom"], s["panelRoom"])
        key = (s["title"], room, s["date"], s["start"], s["end"])
        if key not in seen_dedup:
            seen_dedup.add(key)
            source_unique.append({**s, "panelRoom": room})

    # ---------------------------------------------------------------
    # Per-event matching: source vs existing
    # ---------------------------------------------------------------
    source_key_set = set(event_key(s) for s in source_unique)
    existing_key_set = set(event_key(e) for e in existing_events)

    source_slot_map = {}
    for s in source_unique:
        slot = (s["panelRoom"], s["date"], s["start"], s["end"])
        # Multiple source events can share a slot (e.g. concurrent TCG events)
        source_slot_map.setdefault(slot, []).append(s)

    # Events matched by key (identical) - no action needed
    matched_keys = source_key_set & existing_key_set

    # Events only in source (by key)
    keys_only_in_source = source_key_set - existing_key_set
    # Events only in existing (by key)
    keys_only_in_existing = existing_key_set - source_key_set

    source_only_events = [s for s in source_unique if event_key(s) in keys_only_in_source]
    existing_only_events = [e for e in existing_events if event_key(e) in keys_only_in_existing]

    # Try to match source-only and existing-only by slot (room+date+start+end)
    # If same slot, different title → likely a rename
    existing_only_by_slot = defaultdict(list)
    for e in existing_only_events:
        slot = (e["panelRoom"], e["date"], e["start"], e["end"])
        existing_only_by_slot[slot].append(e)

    source_only_by_slot = defaultdict(list)
    for s in source_only_events:
        slot = (s["panelRoom"], s["date"], s["start"], s["end"])
        source_only_by_slot[slot].append(s)

    # Find slot-matched pairs (same slot, different title)
    slot_matched_pairs = []     # (existing_ev, source_ev)
    remaining_source_only = []  # source events with no slot match
    remaining_existing_only = []  # existing events with no slot match

    matched_existing_keys = set()
    matched_source_keys = set()

    for slot, src_list in source_only_by_slot.items():
        if slot in existing_only_by_slot:
            ex_list = existing_only_by_slot[slot]
            # Pair them up 1:1 by position
            for i, src in enumerate(src_list):
                if i < len(ex_list):
                    slot_matched_pairs.append((ex_list[i], src))
                    matched_existing_keys.add(event_key(ex_list[i]))
                    matched_source_keys.add(event_key(src))
                else:
                    remaining_source_only.append(src)
            for j in range(len(src_list), len(ex_list)):
                remaining_existing_only.append(ex_list[j])
        else:
            remaining_source_only.extend(src_list)

    for slot, ex_list in existing_only_by_slot.items():
        for e in ex_list:
            if event_key(e) not in matched_existing_keys:
                remaining_existing_only.append(e)

    # ---------------------------------------------------------------
    # Report / interactive resolve
    # ---------------------------------------------------------------
    # rename_map: old_event_key -> new_event_key
    rename_map = {}
    # deleted_events: list of event_keys that were fabricated
    deleted_events = []

    if check_only:
        # --- Estimation mode ---
        if slot_matched_pairs:
            print(f"\n{'='*60}")
            print(f"SLOT-MATCHED (same room+time, different title/key): {len(slot_matched_pairs)}")
            print(f"{'='*60}")
            for ex, src in slot_matched_pairs:
                print(f"  OLD: {fmt_event(ex)}")
                print(f"  NEW: {fmt_event(src)}")
                print(f"    old key: {event_key(ex)}")
                print(f"    new key: {event_key(src)}")
                print()

        if remaining_source_only:
            print(f"\n{'='*60}")
            print(f"SOURCE-ONLY (no matching slot in existing): {len(remaining_source_only)}")
            print(f"{'='*60}")
            for s in remaining_source_only:
                print(f"  {fmt_event(s)}")
            print()

        if remaining_existing_only:
            print(f"\n{'='*60}")
            print(f"EXISTING-ONLY (no matching slot in source): {len(remaining_existing_only)}")
            print(f"{'='*60}")
            for e in remaining_existing_only:
                print(f"  {fmt_event(e)}")
            print()

        n_issues = len(slot_matched_pairs) + len(remaining_source_only) + len(remaining_existing_only)
        if n_issues:
            print(f"Total per-event mismatch issues: {n_issues}")

    else:
        # --- Interactive mode ---
        # Track keys that have been resolved so we skip them in later sections
        resolved_source_keys = set()
        resolved_existing_keys = set()

        # 1) Slot-matched pairs: same slot, different title → likely rename
        for ex, src in slot_matched_pairs:
            old_key = event_key(ex)
            new_key = event_key(src)
            print(f"\nSame slot, different event key:")
            print(f"  OLD: {fmt_event(ex)}")
            print(f"  NEW: {fmt_event(src)}")
            choice = ask_choice("What happened?", [
                f"Event was renamed/corrected -> map old key to new key",
                "These are two different events (keep both as-is)",
            ])
            if choice == 0:
                rename_map[old_key] = new_key
                resolved_source_keys.add(new_key)
                resolved_existing_keys.add(old_key)

        # Build lookup for quick cross-referencing
        source_only_by_key = {event_key(s): s for s in remaining_source_only}
        existing_only_by_key = {event_key(e): e for e in remaining_existing_only}

        # 2) Source-only events with no slot match
        unresolved_source = [s for s in remaining_source_only
                             if event_key(s) not in resolved_source_keys]
        if unresolved_source:
            print(f"\n{'='*60}")
            print(f"Events in source but NOT in existing ({len(unresolved_source)}):")
            print(f"{'='*60}")
            for s in unresolved_source:
                new_key = event_key(s)
                if new_key in resolved_source_keys:
                    continue
                print(f"\n  NEW: {fmt_event(s)}")
                print(f"    key: {new_key}")
                choice = ask_choice("What to do?", [
                    "This event was completely missed -- just add it",
                    "This event existed under a different key in old file -- enter old event key",
                ])
                if choice == 1:
                    while True:
                        old_k = input("  Enter the old event key (date|room|title|start): ").strip()
                        if not old_k:
                            break
                        if old_k in existing_key_set or old_k in existing_only_by_key:
                            rename_map[old_k] = new_key
                            resolved_source_keys.add(new_key)
                            resolved_existing_keys.add(old_k)
                            break
                        print(f"  Key not found in existing file. Try again (or empty to skip).")

        # 3) Existing-only events with no slot match
        unresolved_existing = [e for e in remaining_existing_only
                               if event_key(e) not in resolved_existing_keys]
        if unresolved_existing:
            print(f"\n{'='*60}")
            print(f"Events in existing but NOT in source ({len(unresolved_existing)}):")
            print(f"{'='*60}")
            for e in unresolved_existing:
                old_key = event_key(e)
                if old_key in resolved_existing_keys:
                    continue
                print(f"\n  GONE: {fmt_event(e)}")
                print(f"    key: {old_key}")
                choice = ask_choice("What happened?", [
                    "This event was made up / doesn't exist -> delete",
                    "This event was renamed/moved -> enter new event key",
                    "Keep it as-is (manually added event)",
                ])
                if choice == 0:
                    deleted_events.append(old_key)
                elif choice == 1:
                    while True:
                        new_k = input("  Enter the new event key (date|room|title|start): ").strip()
                        if not new_k:
                            break
                        if new_k in source_key_set or new_k in source_only_by_key:
                            rename_map[old_key] = new_k
                            resolved_existing_keys.add(old_key)
                            resolved_source_keys.add(new_k)
                            break
                        print(f"  Key not found in source. Try again (or empty to skip).")

    # ---------------------------------------------------------------
    # Build converted events
    # ---------------------------------------------------------------
    converted_events = []
    seen = set()

    # Add all source events (authoritative)
    for s in source_unique:
        key = (s["title"], s["panelRoom"], s["date"], s["start"], s["end"])
        if key in seen:
            continue
        seen.add(key)

        slot = (s["panelRoom"], s["date"], s["start"], s["end"])
        # If this slot existed in old file, preserve old title UNLESS renamed
        if slot in existing_by_slot:
            ex = existing_by_slot[slot]
            old_ek = event_key(ex)
            if old_ek in rename_map:
                # Use source title (the rename target)
                title = s["title"]
            else:
                title = ex["title"]  # preserve existing title
        else:
            title = s["title"]

        event = {
            "title": title,
            "panelRoom": s["panelRoom"],
            "start": s["start"],
            "end": s["end"],
            "panelDescription": s["panelDescription"],
            "ticket": s["ticket"],
            "date": s["date"],
        }
        converted_events.append(event)

    # Add existing-only events that weren't deleted/renamed
    source_slots = set(
        (s["panelRoom"], s["date"], s["start"], s["end"]) for s in source_unique
    )
    for e in existing_events:
        slot = (e["panelRoom"], e["date"], e["start"], e["end"])
        if slot in source_slots:
            continue  # handled above
        ek = event_key(e)
        if ek in deleted_events:
            continue
        if ek in rename_map:
            continue  # renamed to something in source
        converted_events.append(e)

    # ---------------------------------------------------------------
    # Overlap warnings
    # ---------------------------------------------------------------
    events_by_room_date = defaultdict(list)
    for e in converted_events:
        events_by_room_date[(e["panelRoom"], e["date"])].append(e)

    for (room, date), evts in events_by_room_date.items():
        for i in range(len(evts)):
            for j in range(i + 1, len(evts)):
                e1, e2 = evts[i], evts[j]
                if e1["start"] == e2["start"] and e1["end"] == e2["end"]:
                    if e1["title"] != e2["title"]:
                        warnings.append(
                            f"OVERLAP SAME TIME: room='{room}', {date}, "
                            f"'{e1['title']}' vs '{e2['title']}' ({e1['start']}-{e1['end']})"
                        )
                    continue
                s1 = parse_time_minutes(e1["start"])
                end1 = parse_time_minutes(e1["end"])
                s2 = parse_time_minutes(e2["start"])
                end2 = parse_time_minutes(e2["end"])
                if end1 <= s1:
                    end1 += 24 * 60
                if end2 <= s2:
                    end2 += 24 * 60
                if s1 < end2 and s2 < end1:
                    warnings.append(
                        f"TIME OVERLAP: room='{room}', {date}, "
                        f"'{e1['title']}' ({e1['start']}-{e1['end']}) vs "
                        f"'{e2['title']}' ({e2['start']}-{e2['end']})"
                    )

    # ---------------------------------------------------------------
    # Sort
    # ---------------------------------------------------------------
    converted_events.sort(key=sort_key)

    # ---------------------------------------------------------------
    # Print warnings / errors
    # ---------------------------------------------------------------
    if warnings:
        print(f"\n{'='*60}")
        print(f"WARNINGS: {len(warnings)}")
        print(f"{'='*60}")
        for i, w in enumerate(warnings, 1):
            print(f"  {i}. {w}")

    if errors:
        print(f"\n{'='*60}")
        print(f"ERRORS: {len(errors)}")
        print(f"{'='*60}")
        for i, err in enumerate(errors, 1):
            print(f"  {i}. {err}")
        print(f"\nTotal errors: {len(errors)}")
        print("NOT writing output file due to errors.")
        sys.exit(1)

    if check_only:
        print(f"\nEstimation complete. {len(converted_events)} events would be produced.")
        print(f"  Matched by key: {len(matched_keys)}")
        return

    # ---------------------------------------------------------------
    # Write output
    # ---------------------------------------------------------------
    output_data = {
        "name": existing_data.get("name", "Sakura-Con 2026"),
        "startDate": existing_data.get("startDate", "April 3, 2026"),
        "endDate": existing_data.get("endDate", "April 5, 2026"),
        "roomColumnWidth": existing_data.get("roomColumnWidth", 300),
        "events": converted_events,
    }

    if rename_map:
        output_data["_renameMap"] = rename_map
    if deleted_events:
        output_data["_deletedEvents"] = deleted_events

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\nSuccessfully wrote {len(converted_events)} events to {output_path}")
    print(f"  Source sessions: {len(source_sessions)} (deduped: {len(source_unique)})")
    print(f"  Existing events: {len(existing_events)}")
    print(f"  Matched by key: {len(matched_keys)}")
    if rename_map:
        print(f"  Renames ({len(rename_map)}):")
        for old, new in rename_map.items():
            print(f"    {old}")
            print(f"      -> {new}")
    if deleted_events:
        print(f"  Deleted ({len(deleted_events)}):")
        for d in deleted_events:
            print(f"    {d}")


def main():
    check_only = "--check" in sys.argv
    run(check_only)


if __name__ == "__main__":
    main()
