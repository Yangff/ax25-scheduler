import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { Event } from "./events";
import type { ConventionMeta, Convention } from "./conventions";
import { fetchConventionList, fetchConvention, generateDates, stripYear } from "./conventions";
import "./App.css";

function useLongPress(callback: () => void, ms = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const didLongPress = useRef(false);

  const start = useCallback(() => {
    didLongPress.current = false;
    timerRef.current = setTimeout(() => {
      didLongPress.current = true;
    }, ms);
  }, [ms]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    onTouchStart: start,
    onTouchEnd: (e: React.TouchEvent) => {
      if (didLongPress.current) {
        e.preventDefault(); // prevent the click from firing
        callbackRef.current(); // call here so window.open works as user gesture
      }
      cancel();
    },
    onTouchMove: cancel,
  };
}

const getRooms = (events: Event[]) =>
  Array.from(new Set(events.map((e: Event) => e.panelRoom)));

/**
 * Sort rooms: group by prefix (before " - "), sort by extracted room number within groups.
 * Rooms with many sub-columns (>2) are pushed to the end.
 */
function sortRooms(rooms: string[], roomSubCols: Map<string, number>): string[] {
  // Parse room name into prefix and numeric suffix for sorting
  function parseRoom(name: string): { prefix: string; num: number; raw: string } {
    const dashIdx = name.indexOf(" - ");
    const prefix = dashIdx >= 0 ? name.substring(0, dashIdx) : name;
    // Extract leading number(s) from the location part
    const location = dashIdx >= 0 ? name.substring(dashIdx + 3) : "";
    const numMatch = location.match(/(\d+)/);
    const num = numMatch ? parseInt(numMatch[1], 10) : 0;
    return { prefix, num, raw: name };
  }

  const parsed = rooms.map(r => ({ ...parseRoom(r), subCols: roomSubCols.get(r) || 1 }));

  parsed.sort((a, b) => {
    // Push rooms with >2 sub-columns to the end
    const aHeavy = a.subCols > 2 ? 1 : 0;
    const bHeavy = b.subCols > 2 ? 1 : 0;
    if (aHeavy !== bHeavy) return aHeavy - bHeavy;

    // Group by prefix
    if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix);

    // Within same prefix, sort by room number
    if (a.num !== b.num) return a.num - b.num;

    // Fallback: alphabetical
    return a.raw.localeCompare(b.raw);
  });

  return parsed.map(p => p.raw);
}

const parseTime = (t: string): number => {
  // "10:00 AM" or "4:30 PM"
  const [time, ampm] = t.split(" ");
  let [h, m] = time.split(":").map(Number);
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h + m / 60;
};

// For events that cross midnight (end < start), cap end at 24 (midnight)
const effectiveEnd = (e: Event): number => {
  const s = parseTime(e.start);
  const en = parseTime(e.end);
  return en <= s ? 24 : en;
};

const formatTime = (h: number): string => {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${min.toString().padStart(2, "0")} ${ampm}`;
};

function useLocalSelection(
  conventionId: string,
  renameMap?: Record<string, string>,
  deletedEvents?: string[],
) {
  const key = `scheduler-selected-${conventionId}`;
  const [selected, setSelected] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return new Set(JSON.parse(atob(raw)));
    } catch {}
    return new Set();
  });
  const save = useCallback((sel: Set<string>) => {
    setSelected(new Set(sel));
    localStorage.setItem(key, btoa(JSON.stringify(Array.from(sel))));
  }, [key]);
  // Reload and migrate when conventionId changes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const arr: string[] = JSON.parse(atob(raw));
        const migrated = new Set<string>();
        const renames: string[] = [];
        const deletions: string[] = [];

        for (const id of arr) {
          if (deletedEvents?.includes(id)) {
            deletions.push(id);
            console.log(`[migration] Removed deleted event: ${id}`);
          } else if (renameMap && id in renameMap) {
            migrated.add(renameMap[id]);
            renames.push(`${id} → ${renameMap[id]}`);
          } else {
            migrated.add(id);
          }
        }

        if (renames.length > 0 || deletions.length > 0) {
          const msgs: string[] = [
            "Your saved selections were updated due to schedule changes:\n",
          ];
          if (renames.length > 0) {
            msgs.push("Moved/renamed events:");
            for (const r of renames) {
              // Extract title from key format "date|room|title|start"
              const parts = r.split(" → ");
              const oldTitle = parts[0].split("|")[2] || parts[0];
              const newRoom = parts[1].split("|")[1] || "";
              msgs.push(`  • "${oldTitle}" moved to ${newRoom}`);
            }
          }
          if (deletions.length > 0) {
            msgs.push("\nRemoved events (no longer in the schedule):");
            for (const d of deletions) {
              const title = d.split("|")[2] || d;
              msgs.push(`  • "${title}"`);
            }
            msgs.push("\n(These events were incorrectly added previously. Sorry for the inconvenience!)");
          }
          alert(msgs.join("\n"));
          setSelected(migrated);
          localStorage.setItem(key, btoa(JSON.stringify(Array.from(migrated))));
        } else {
          setSelected(migrated);
        }
      } else {
        setSelected(new Set());
      }
    } catch {
      setSelected(new Set());
    }
  }, [key, renameMap, deletedEvents]);
  return [selected, save] as const;
}

function replaceNonLatinWithUnderscore(str: string): string {
  return str.replace(/[^\u0000-\u007f]/g, '_');
}

function getEventId(e: Event) {
  // escape non Latin characters in title (allow most ascii, not just 0-9a-z)
  const title = replaceNonLatinWithUnderscore(e.title);
  return `${e.date}|${e.panelRoom}|${title}|${e.start}`;
}

function EditEventCard({
  ev, id, sel, overlapStatus, span, roomIndex, slotIndex,
  onToggle, onPopup,
}: {
  ev: Event; id: string; sel: boolean; overlapStatus: 'none' | 'adjacent' | 'overlap'; span: number;
  roomIndex: number; slotIndex: number;
  onToggle: () => void; onPopup: () => void;
}) {
  const longPress = useLongPress(onPopup);
  return (
    <div
      key={id}
      className={
        "ax2025-event" +
        (sel ? " selected" : "") +
        (overlapStatus === 'overlap' ? " ax2025-collision" : "") +
        (overlapStatus === 'adjacent' ? " ax2025-adjacent" : "") +
        (span > 1 ? " multi-slot" : "")
      }
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") onToggle();
      }}
      onDoubleClick={onPopup}
      {...longPress}
      aria-label={ev.title}
      title={ev.title}
      style={{
        gridColumn: roomIndex + 2,
        gridRow: `${slotIndex + 2} / span ${span}`,
        "--slot-span": span,
      } as React.CSSProperties}
    >
      <div className="ax2025-event-title">{ev.title}</div>
      {span > 1 && (
        <div className="ax2025-event-time">
          {ev.start} - {ev.end}
        </div>
      )}
      {overlapStatus === 'overlap' && (
        <div className="ax2025-overlap-badge">Overlap!</div>
      )}
      {overlapStatus === 'adjacent' && (
        <div className="ax2025-adjacent-badge">Adjacent</div>
      )}
    </div>
  );
}

function App() {
  // Convention state
  const [conventionList, setConventionList] = useState<ConventionMeta[]>([]);
  const [conventionId, setConventionId] = useState<string>(() => {
    return localStorage.getItem("scheduler-active-convention") || "";
  });
  const [convention, setConvention] = useState<Convention | null>(null);
  const [loading, setLoading] = useState(true);

  // Load convention list on mount
  useEffect(() => {
    fetchConventionList().then(({ conventions: list, defaultId }) => {
      setConventionList(list);
      // If no saved convention or saved one doesn't exist, use closest
      if (list.length > 0) {
        setConventionId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev;
          return defaultId || list[0].id;
        });
      }
      setLoading(false);
    });
  }, []);

  // Load convention data when conventionId changes
  useEffect(() => {
    if (!conventionId) return;
    setLoading(true);
    fetchConvention(conventionId).then((data) => {
      setConvention(data);
      setLoading(false);
    });
    localStorage.setItem("scheduler-active-convention", conventionId);
  }, [conventionId]);

  // Derive dates from convention metadata
  const DATES = useMemo(() => {
    if (!convention) return [];
    return generateDates(convention.startDate, convention.endDate);
  }, [convention]);

  const [date, setDate] = useState("");
  // Reset date when DATES changes
  useEffect(() => {
    if (DATES.length > 0 && !DATES.includes(date)) {
      setDate(DATES[0]);
    }
  }, [DATES, date]);

  const [editMode, setEditMode] = useState(() => {
    const savedEditMode = localStorage.getItem("scheduler-edit-mode");
    return savedEditMode === null ? true : savedEditMode === "true";
  });
  const allEvents = convention?.events ?? [];
  const events = useMemo(() => allEvents.filter((e) => e.date === date), [allEvents, date]);
  const unsortedRooms = useMemo(() => getRooms(events), [events]);
  const [selected, setSelected] = useLocalSelection(
    conventionId || "__none__",
    convention?._renameMap,
    convention?._deletedEvents,
  );
  const [popup, setPopup] = useState<Event | null>(null);

  // On mobile, open event details in a real new tab; on desktop, use the popup
  const isMobile = useCallback(() => screen.width <= 600, []);

  const showEventDetail = useCallback((ev: Event) => {
    if (isMobile()) {
      const data = encodeURIComponent(JSON.stringify({
        title: ev.title,
        panelRoom: ev.panelRoom,
        start: ev.start,
        end: ev.end,
        date: ev.date,
        ticket: ev.ticket,
        panelDescription: ev.panelDescription,
      }));
      window.open(window.location.pathname + '?detail=' + data, '_blank');
    } else {
      setPopup(ev);
    }
  }, []);

  const [showDisclaimer, setShowDisclaimer] = useState(() => {
    return localStorage.getItem("scheduler-disclaimer-shown") !== "1";
  });
  
  // Google Form URL state with localStorage persistence
  const [googleFormUrl, setGoogleFormUrl] = useState(() => {
    return localStorage.getItem("scheduler-google-form-url") || "";
  });
  
  // Save Google Form URL to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("scheduler-google-form-url", googleFormUrl);
  }, [googleFormUrl]);

  // Save disclaimer state
  useEffect(() => {
    if (!showDisclaimer) {
      localStorage.setItem("scheduler-disclaimer-shown", "1");
    }
  }, [showDisclaimer]);
  
  // Save edit mode state
  useEffect(() => {
    localStorage.setItem("scheduler-edit-mode", String(editMode));
  }, [editMode]);

  // Lock body scrolling in edit mode
  useEffect(() => {
    if (editMode) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [editMode]);

  // Compute sub-column layout for overlapping events in the same room
  // Returns: { subColMap: Map<eventKey, subColIndex>, roomSubCols: Map<roomName, numSubCols> }
  const { subColMap, roomSubCols, roomGridStart, rooms } = useMemo(() => {
    const subColMap = new Map<string, number>(); // eventKey -> sub-column index (0-based)
    const roomSubCols = new Map<string, number>(); // room -> number of sub-columns needed
    const roomGridStart = new Map<string, number>(); // room -> grid column start (1-based, after time col)

    // Group events by room
    const eventsByRoom = new Map<string, Event[]>();
    for (const e of events) {
      const list = eventsByRoom.get(e.panelRoom) || [];
      list.push(e);
      eventsByRoom.set(e.panelRoom, list);
    }

    // For each room, assign sub-columns using greedy interval coloring
    for (const room of unsortedRooms) {
      const roomEvents = eventsByRoom.get(room) || [];
      // Sort by start time, then by end time
      const sorted = [...roomEvents].sort((a, b) => {
        const sa = parseTime(a.start), sb = parseTime(b.start);
        if (sa !== sb) return sa - sb;
        return effectiveEnd(a) - effectiveEnd(b);
      });

      // Greedy coloring: track end time of each sub-column
      const colEnds: number[] = []; // colEnds[i] = end time of latest event in sub-col i

      for (const ev of sorted) {
        const evStart = parseTime(ev.start);
        const evEnd = effectiveEnd(ev);
        // Find first sub-column where this event doesn't overlap
        let assigned = -1;
        for (let c = 0; c < colEnds.length; c++) {
          if (colEnds[c] <= evStart) {
            assigned = c;
            colEnds[c] = evEnd;
            break;
          }
        }
        if (assigned === -1) {
          assigned = colEnds.length;
          colEnds.push(evEnd);
        }
        subColMap.set(getEventId(ev), assigned);
      }

      roomSubCols.set(room, Math.max(1, colEnds.length));
    }

    // Sort rooms: group by prefix, numeric order, heavy rooms last
    const rooms = sortRooms(unsortedRooms, roomSubCols);

    // Compute grid column start for each room
    let col = 2; // column 1 is time column
    for (const room of rooms) {
      roomGridStart.set(room, col);
      col += roomSubCols.get(room) || 1;
    }
    return { subColMap, roomSubCols, roomGridStart, rooms };
  }, [events, unsortedRooms]);

  // Build time slots
  const slots = useMemo(() => {
    let times: number[] = [];
    events.forEach((e: Event) => {
      const s = parseTime(e.start);
      const en = effectiveEnd(e);
      times.push(s, en);
    });
    times = Array.from(new Set(times)).sort((a, b) => a - b);
    // Only show slots with at least one event
    return times.filter((t: number) =>
      events.some(
        (e: Event) => parseTime(e.start) <= t && effectiveEnd(e) > t
      )
    );
  }, [events]);

  // Calculate event span (how many slots it covers)
  const calculateEventSpan = (event: Event, allSlots: number[]): number => {
    const startTime = parseTime(event.start);
    const endTime = effectiveEnd(event);
    
    // Find the indices in the slots array
    const startIndex = allSlots.findIndex(t => t === startTime);
    const endIndex = allSlots.findIndex(t => t === endTime);
    
    if (startIndex === -1 || endIndex === -1) {
      // If exact time not found, calculate span by counting slots between start and end
      return allSlots.filter(t => t >= startTime && t < endTime).length;
    }
    
    return endIndex - startIndex;
  };

  // Overlap detection: 'none' | 'adjacent' (warning) | 'overlap' (error)
  function getOverlapStatus(ev: Event): 'none' | 'adjacent' | 'overlap' {
    const thisId = getEventId(ev);
    const thisStart = parseTime(ev.start);
    const thisEnd = effectiveEnd(ev);
    let hasAdjacent = false;
    for (const e of events) {
      if (getEventId(e) === thisId) continue;
      if (!selected.has(getEventId(e))) continue;
      const s = parseTime(e.start);
      const en = effectiveEnd(e);
      const sameRoom = ev.panelRoom === e.panelRoom;
      if (sameRoom) {
        // Same room: only conflict if they truly overlap (not just adjacent)
        if (thisStart < en && thisEnd > s) {
          return 'overlap';
        }
      } else {
        // Different room: true overlap
        if (thisStart < en && thisEnd > s) {
          return 'overlap';
        }
        // Different room: adjacent (start == end or end == start)
        if (thisStart === en || thisEnd === s) {
          hasAdjacent = true;
        }
      }
    }
    return hasAdjacent ? 'adjacent' : 'none';
  }

  // Export/import selection (includes convention ID for validation)
  function exportSelection(): string {
    const payload = { conventionId, selected: Array.from(selected) };
    return btoa(JSON.stringify(payload));
  }
  function importSelection(str: string): void {
    try {
      const raw = JSON.parse(atob(str));
      // Support both old format (plain array) and new format (with conventionId)
      if (Array.isArray(raw)) {
        setSelected(new Set(raw));
      } else if (raw && Array.isArray(raw.selected)) {
        if (raw.conventionId && raw.conventionId !== conventionId) {
          if (!confirm(`This export is from "${raw.conventionId}" but you have "${conventionId}" selected. Import anyway?`)) {
            return;
          }
        }
        setSelected(new Set(raw.selected));
      }
    } catch {}
  }

  // Form reference for Google Sync
  const googleFormRef = React.useRef<HTMLFormElement>(null);
  const syncToGoogle = () => {
    if (googleFormRef.current) {
      // Update the data field value right before submitting
      const dataInput = googleFormRef.current.querySelector('input[name="data"]') as HTMLInputElement;
      if (dataInput) {
        dataInput.value = JSON.stringify(Array.from(selected));
      }
      googleFormRef.current.submit();
    }
  };

  // Modal states
  const [showSettings, setShowSettings] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");

  // Header ref for measuring height (fixed positioning needs spacer)
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(60);
  useEffect(() => {
    if (!headerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setHeaderHeight(entry.contentRect.height + 16);
    });
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  // Edit mode icons
  const EditIcon = () => (
    <div className="ax2025-mode-icon" title="Switch to Edit Mode">
      ✏️
    </div>
  );
  
  const ViewIcon = () => (
    <div className="ax2025-mode-icon" title="Switch to View Mode">
      📅
    </div>
  );

  if (loading || !convention) {
    return (
      <div className="ax2025-root">
        <div style={{ padding: 32, textAlign: 'center' }}>Loading convention data...</div>
      </div>
    );
  }

  return (
    <div className={`ax2025-root${editMode ? ' ax2025-root-edit' : ''}`}>
      {showDisclaimer && (
        <div className="ax2025-disclaimer-popup">
          <div className="ax2025-disclaimer-content">
            <b>Notice:</b> This project is not affiliated with any official organization and does not take responsibility for the information provided.
            <button onClick={() => setShowDisclaimer(false)} style={{marginLeft: 16}}>Dismiss</button>
          </div>
        </div>
      )}
      <div className="ax2025-header" ref={headerRef}>
        <div className="ax2025-tabs">
          {DATES.map((d: string) => (
            <button
              key={d}
              className={d === date ? "active" : ""}
              onClick={() => setDate(d)}
            >
              {stripYear(d)}
            </button>
          ))}
        </div>
      </div>
      
      {/* Google Form placed outside of edit/display mode conditional */}
      <form
        ref={googleFormRef}
        action={googleFormUrl}
        method="POST"
        style={{ display: "none" }}
      >
        <input type="hidden" name="action" value="sync" />
        <input type="hidden" name="data" value="" />
      </form>
      
      <div className="ax2025-calendar" style={{ 
        paddingTop: headerHeight,
        ...(editMode ? { height: '100dvh', boxSizing: 'border-box' } : {})
      }}>
        {editMode ? (
          <div className="ax2025-edit">
              <div className="ax2025-calendar-body" style={{ 
                display: 'inline-grid',
                gridTemplateColumns: `auto ${rooms.map(r => {
                  const n = roomSubCols.get(r) || 1;
                  const w = convention.roomColumnWidth ?? 160;
                  if (n === 1) return `minmax(${w}px, 1fr)`;
                  const totalW = Math.max(w, 160 * n);
                  const colW = Math.floor(totalW / n);
                  return Array(n).fill(`${colW}px`).join(' ');
                }).join(' ')}`,
                gridAutoRows: 'auto',
                minWidth: '100%',
              }}>
                {/* Row 1: Sticky header — corner cell + room names */}
                <div
                  className="ax2025-calendar-timecol ax2025-sticky-corner"
                  style={{ gridColumn: 1, gridRow: 1 }}
                ></div>
                {rooms.map((room: string) => {
                  const gridStart = roomGridStart.get(room) || 2;
                  const span = roomSubCols.get(room) || 1;
                  return (
                  <div
                    key={room}
                    className="ax2025-calendar-room ax2025-room-header ax2025-sticky-header"
                    style={{ gridColumn: `${gridStart} / span ${span}`, gridRow: 1 }}
                    title={room}
                  >
                    <span className="ax2025-room-label">{room}</span>
                  </div>
                  );
                })}

                {/* Render time slots — shifted to row slotIndex + 2 */}
                {slots.map((t, slotIndex) => (
                  <div
                    className="ax2025-calendar-row ax2025-sticky-timecol"
                    key={t}
                    style={{
                      gridColumn: 1,
                      gridRow: slotIndex + 2,
                    }}
                  >
                    <div className="ax2025-calendar-timecol">
                      {formatTime(t)}
                    </div>
                  </div>
                ))}
                
                {/* Render events in rooms — using sub-column layout */}
                {rooms.map((room) => {
                  const gridStart = roomGridStart.get(room) || 2;
                  const numSubCols = roomSubCols.get(room) || 1;
                  // Track which slots are occupied per sub-column
                  const occupiedSlots = Array.from({ length: numSubCols }, () => new Set<number>());
                  
                  // Get events for this room sorted by start time
                  const roomEvents = events
                    .filter((e: Event) => e.panelRoom === room)
                    .sort((a, b) => parseTime(a.start) - parseTime(b.start));
                  
                  // Render empty gridline cells for the full room span
                  const gridLines = slots.map((t, slotIndex) => {
                    // Check if ANY event covers this slot
                    const anyCover = roomEvents.some(e => parseTime(e.start) <= t && effectiveEnd(e) > t);
                    if (anyCover) return null;
                    return (
                      <div
                        key={`${room}-empty-${t}`}
                        style={{
                          gridColumn: `${gridStart} / span ${numSubCols}`,
                          gridRow: slotIndex + 2,
                        }}
                        className="ax2025-time-gridline"
                      ></div>
                    );
                  });

                  // Render each event in its assigned sub-column
                  const eventCards = roomEvents.map((ev) => {
                    const id = getEventId(ev);
                    const subCol = subColMap.get(id) || 0;
                    const evStartTime = parseTime(ev.start);
                    const slotIndex = slots.indexOf(evStartTime);
                    if (slotIndex === -1) return null;
                    
                    // Check if slot already rendered (dedup)
                    if (occupiedSlots[subCol].has(slotIndex)) return null;
                    
                    const span = calculateEventSpan(ev, slots);
                    for (let i = 0; i < span; i++) {
                      occupiedSlots[subCol].add(slotIndex + i);
                    }
                    
                    const sel = selected.has(id);
                    const overlapStatus = sel ? getOverlapStatus(ev) : 'none';

                    return (
                      <EditEventCard
                        key={id}
                        ev={ev}
                        id={id}
                        sel={sel}
                        overlapStatus={overlapStatus}
                        span={span}
                        roomIndex={gridStart + subCol - 2}
                        slotIndex={slotIndex}
                        onToggle={() => {
                          const next: Set<string> = new Set(selected);
                          if (sel) next.delete(id);
                          else next.add(id);
                          setSelected(next);
                        }}
                        onPopup={() => showEventDetail(ev)}
                      />
                    );
                  });

                  return [...gridLines, ...eventCards];
                })}
              </div>
            <div className="ax2025-export">
              <button
                onClick={() => {
                  const str = exportSelection();
                  navigator.clipboard.writeText(str);
                  alert("Selection exported to clipboard!");
                }}
              >
                Export Selection
              </button>
              <button onClick={() => setShowImportModal(true)}>
                Import Selection
              </button>
              <button onClick={syncToGoogle} disabled={!googleFormUrl}>Sync Google</button>
              <button onClick={() => setShowSettings(true)} style={{ marginLeft: '8px' }}>
                Google Settings
              </button>
              {conventionList.length > 1 && (
                <select
                  className="ax2025-convention-select"
                  value={conventionId}
                  onChange={(e) => setConventionId(e.target.value)}
                >
                  {conventionList.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
              {conventionList.length === 1 && (
                <span className="ax2025-convention-name">{convention.name}</span>
              )}
              <div 
                className="ax2025-mode"
                onClick={() => setEditMode(!editMode)}
                title={editMode ? "Switch to Display Mode" : "Switch to Edit Mode"}
              >
                <input
                  type="checkbox"
                  checked={editMode}
                  onChange={() => {}}
                />
                {editMode ? <ViewIcon /> : <EditIcon />}
              </div>
            </div>
          </div>
        ) : (
          <div className="ax2025-display">
            {(() => {
              // Calculate how many columns we need for the selected events
              const selectedEvents = events
                .filter(e => selected.has(getEventId(e)))
                .sort((a, b) => parseTime(a.start) - parseTime(b.start));
              
              if (selectedEvents.length === 0) {
                return (
                  <div className="ax2025-empty-selection">
                    <p>No events selected. Switch to Edit mode to select events.</p>
                  </div>
                );
              }
              
              // Group events into columns using interval coloring algorithm
              const columns: Event[][] = [];
              
              // For each event, find the first column where it doesn't overlap with existing events
              selectedEvents.forEach(event => {
                const eventStart = parseTime(event.start);
                
                let columnIndex = 0;
                let placed = false;
                
                while (!placed && columnIndex < columns.length) {
                  const column = columns[columnIndex];
                  const lastEvent = column[column.length - 1];
                  
                  // If this event starts after the last event in this column ends
                  if (effectiveEnd(lastEvent) <= eventStart) {
                    column.push(event);
                    placed = true;
                  } else {
                    columnIndex++;
                  }
                }
                
                if (!placed) {
                  // Create a new column for this event
                  columns.push([event]);
                }
              });
              
              const numColumns = columns.length;
              
              return (
                <div className="ax2025-calendar-body" style={{ 
                    display: 'inline-grid',
                    gridTemplateColumns: `auto repeat(${numColumns}, minmax(${convention.roomColumnWidth ?? 160}px, 1fr))`,
                    gridAutoRows: 'minmax(40px, auto)',
                    minWidth: '100%',
                  }}>
                    {/* Row 1: Header — corner cell + column headers */}
                    <div
                      className="ax2025-calendar-timecol"
                      style={{ gridColumn: 1, gridRow: 1, background: '#e3eafc' }}
                    ></div>
                    {columns.map((_, colIdx) => (
                      <div 
                        key={colIdx}
                        className="ax2025-calendar-room ax2025-room-header"
                        style={{ gridColumn: colIdx + 2, gridRow: 1 }}
                      >
                        My Events {numColumns > 1 ? `(${colIdx + 1})` : ''}
                      </div>
                    ))}

                    {/* Time slot gridlines — shifted to row idx + 2 */}
                    {slots.map((t, idx) => (
                      <div 
                        key={`gridline-${t}`}
                        className="ax2025-time-gridline"
                        style={{
                          gridColumn: `1 / span ${numColumns + 1}`,
                          gridRow: idx + 2,
                          borderBottom: '1px solid #e0e0e0',
                          pointerEvents: 'none',
                          zIndex: 1,
                        }}
                      />
                    ))}
                    
                    {/* Render time column — shifted to row idx + 2 */}
                    {slots.map((t, idx) => (
                      <div 
                        key={`time-${t}`}
                        className="ax2025-calendar-timecol"
                        style={{
                          gridColumn: 1,
                          gridRow: idx + 2,
                          position: 'relative',
                          zIndex: 2,
                        }}
                      >
                        {formatTime(t)}
                      </div>
                    ))}
                    
                    {/* Render each column of events — rowStart shifted by +1 */}
                    {columns.map((column, colIdx) => 
                      column.map(ev => {
                        // Find the row where this event starts
                        const startSlotIndex = slots.findIndex(t => 
                          parseTime(ev.start) <= t && t < effectiveEnd(ev)
                        );
                        
                        if (startSlotIndex === -1) return null;
                        
                        // Calculate span - how many slots this event covers
                        const span = slots.filter(t => 
                          t >= parseTime(ev.start) && t < effectiveEnd(ev)
                        ).length;
                        
                        // Ensure minimum span of 1
                        const finalSpan = Math.max(1, span);
                        
                        const rowStart = startSlotIndex + 2;
                        
                        return (
                          <div
                            key={getEventId(ev)}
                            className={`ax2025-event selected ${finalSpan > 1 ? 'multi-slot' : ''}`}
                            tabIndex={0}
                            onClick={() => showEventDetail(ev)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                              if (e.key === "Enter" || e.key === " ") showEventDetail(ev);
                            }}
                            aria-label={ev.title}
                            title={ev.title}
                            style={{
                              gridColumn: colIdx + 2,
                              gridRow: `${rowStart} / span ${finalSpan}`,
                              "--slot-span": finalSpan,
                              zIndex: 3,
                              alignSelf: 'stretch',
                              justifySelf: 'stretch',
                            } as React.CSSProperties}
                          >
                            <div className="ax2025-event-title">{ev.title}</div>
                            <div className="ax2025-event-room">{ev.panelRoom}</div>
                            <div className="ax2025-event-time">
                              {ev.start} - {ev.end}
                            </div>
                          </div>
                        );
                      }).filter(Boolean)
                    )}
                  </div>
              );
            })()}
            <div className="ax2025-export">
              <button
                onClick={() => {
                  const str = exportSelection();
                  navigator.clipboard.writeText(str);
                  alert("Selection exported to clipboard!");
                }}
              >
                Export Selection
              </button>
              <button onClick={() => setShowImportModal(true)}>
                Import Selection
              </button>
              <button onClick={syncToGoogle} disabled={!googleFormUrl}>Sync Google</button>
              <button onClick={() => setShowSettings(true)} style={{ marginLeft: '8px' }}>
                Google Settings
              </button>
              {conventionList.length > 1 && (
                <select
                  className="ax2025-convention-select"
                  value={conventionId}
                  onChange={(e) => setConventionId(e.target.value)}
                >
                  {conventionList.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
              {conventionList.length === 1 && (
                <span className="ax2025-convention-name">{convention.name}</span>
              )}
              <div 
                className="ax2025-mode"
                onClick={() => setEditMode(!editMode)}
                title={editMode ? "Switch to Display Mode" : "Switch to Edit Mode"}
              >
                <input
                  type="checkbox"
                  checked={editMode}
                  onChange={() => {}}
                />
                {editMode ? <ViewIcon /> : <EditIcon />}
              </div>
            </div>
          </div>
        )}
      </div>
      {popup && (
        <div
          className="ax2025-popup"
          tabIndex={0}
          onClick={() => setPopup(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPopup(null);
          }}
        >
          <div className="ax2025-popup-content" onClick={(e) => e.stopPropagation()}>
            <h2>{popup.title}</h2>
            <div>
              <b>Room:</b> {popup.panelRoom}
            </div>
            <div>
              <b>Time:</b> {popup.start} - {popup.end}
            </div>
            <div>
              <b>Date:</b> {popup.date}
            </div>
            <div>
              <b>Ticket Required:</b> {popup.ticket ? "Yes" : "No"}
            </div>
            <div style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: popup.panelDescription }} />
            <button onClick={() => setPopup(null)}>Close</button>
          </div>
        </div>
      )}
      
      {/* Settings Modal */}
      {showSettings && (
        <div
          className="ax2025-popup"
          tabIndex={0}
          onClick={() => setShowSettings(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowSettings(false);
          }}
        >
          <div className="ax2025-popup-content" onClick={(e) => e.stopPropagation()}>
            <h2>Settings</h2>
            <div>
              <b>Google Form URL:</b>
              <input 
                type="text" 
                value={googleFormUrl}
                onChange={(e) => setGoogleFormUrl(e.target.value)}
                style={{ width: '85%', marginTop: '8px', padding: '8px' }}
              />
              <div style={{ marginTop: '4px', fontSize: '0.8em', color: '#666' }}>
                Enter your Google Form URL for syncing calendar events. 
                <br />
                <a href="https://github.com/Yangff/ax25-scheduler/blob/main/gscript/readme.md">Click for more information</a>
              </div>
            </div>
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div
          className="ax2025-popup"
          tabIndex={0}
          onClick={() => setShowImportModal(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowImportModal(false);
          }}
        >
          <div className="ax2025-popup-content" onClick={(e) => e.stopPropagation()}>
            <h2>Import Selection</h2>
            <div>
              <b>Paste Base64 Data:</b>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                style={{ 
                  width: '90%', 
                  minHeight: '100px', 
                  marginTop: '8px', 
                  padding: '8px',
                  fontFamily: 'monospace'
                }}
                placeholder="Paste your exported base64 data here"
              />
              <div style={{ marginTop: '4px', fontSize: '0.8em', color: '#666' }}>
                Paste the base64 encoded data that was previously exported
              </div>
            </div>
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => {
                if (importText.trim() !== '') {
                  importSelection(importText.trim());
                  setShowImportModal(false);
                  setImportText('');
                }
              }}>Import</button>
              <button onClick={() => {
                setShowImportModal(false);
                setImportText('');
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
