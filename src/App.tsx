import React, { useState, useMemo, useEffect } from "react";
import { events as allEvents } from "./events";
import type { Event } from "./events";
import "./App.css";

const DATES = [
  "July 3, 2025",
  "July 4, 2025",
  "July 5, 2025",
  "July 6, 2025",
];

const getRooms = (events: Event[]) =>
  Array.from(new Set(events.map((e: Event) => e.panelRoom)));

const parseTime = (t: string): number => {
  // "10:00 AM" or "4:30 PM"
  const [time, ampm] = t.split(" ");
  let [h, m] = time.split(":").map(Number);
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h + m / 60;
};

const formatTime = (h: number): string => {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${min.toString().padStart(2, "0")} ${ampm}`;
};

function useLocalSelection(date: string) {
  const key = `ax2025-selected-${date}`;
  const [selected, setSelected] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return new Set(JSON.parse(atob(raw)));
    } catch {}
    return new Set();
  });
  const save = (sel: Set<string>) => {
    setSelected(new Set(sel));
    localStorage.setItem(key, btoa(JSON.stringify(Array.from(sel))));
  };
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

function App() {
  const [date, setDate] = useState(DATES[0]);
  const [editMode, setEditMode] = useState(() => {
    // Initialize from localStorage or default to true (edit mode)
    const savedEditMode = localStorage.getItem("ax2025-edit-mode");
    return savedEditMode === null ? true : savedEditMode === "true";
  });
  const events = useMemo(() => allEvents.filter((e) => e.date === date), [date]);
  const rooms = useMemo(() => getRooms(events), [events]);
  const [selected, setSelected] = useLocalSelection(date);
  const [popup, setPopup] = useState<Event | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(() => {
    return localStorage.getItem("ax2025-disclaimer-shown") !== "1";
  });
  
  // Google Form URL state with localStorage persistence
  const [googleFormUrl, setGoogleFormUrl] = useState(() => {
    return localStorage.getItem("ax2025-google-form-url") || 
      "";
  });
  
  // Save Google Form URL to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("ax2025-google-form-url", googleFormUrl);
  }, [googleFormUrl]);

  // Save disclaimer state
  useEffect(() => {
    if (!showDisclaimer) {
      localStorage.setItem("ax2025-disclaimer-shown", "1");
    }
  }, [showDisclaimer]);
  
  // Save edit mode state
  useEffect(() => {
    localStorage.setItem("ax2025-edit-mode", String(editMode));
  }, [editMode]);

  // Build time slots
  const slots = useMemo(() => {
    let times: number[] = [];
    events.forEach((e: Event) => {
      const s = parseTime(e.start);
      const en = parseTime(e.end);
      times.push(s, en);
    });
    times = Array.from(new Set(times)).sort((a, b) => a - b);
    // Only show slots with at least one event
    return times.filter((t: number) =>
      events.some(
        (e: Event) => parseTime(e.start) <= t && parseTime(e.end) > t
      )
    );
  }, [events]);

  // Calculate event span (how many slots it covers)
  const calculateEventSpan = (event: Event, allSlots: number[]): number => {
    const startTime = parseTime(event.start);
    const endTime = parseTime(event.end);
    
    // Find the indices in the slots array
    const startIndex = allSlots.findIndex(t => t === startTime);
    const endIndex = allSlots.findIndex(t => t === endTime);
    
    if (startIndex === -1 || endIndex === -1) {
      // If exact time not found, calculate span by counting slots between start and end
      return allSlots.filter(t => t >= startTime && t < endTime).length;
    }
    
    return endIndex - startIndex;
  };

  // Overlap detection
  function isOverlapping(ev: Event): boolean {
    const thisId = getEventId(ev);
    const thisStart = parseTime(ev.start);
    const thisEnd = parseTime(ev.end);
    for (const e of events) {
      if (getEventId(e) === thisId) continue;
      if (!selected.has(getEventId(e))) continue;
      const s = parseTime(e.start);
      const en = parseTime(e.end);
      if (thisStart <= en && thisEnd >= s) {
        return true;
      }
    }
    return false;
  }

  // Export/import selection
  function exportSelection(): string {
    const arr = Array.from(selected);
    return btoa(JSON.stringify(arr));
  }
  function importSelection(str: string): void {
    try {
      const arr = JSON.parse(atob(str));
      setSelected(new Set(arr));
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

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);

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

  return (
    <div className="ax2025-root">
      {showDisclaimer && (
        <div className="ax2025-disclaimer-popup">
          <div className="ax2025-disclaimer-content">
            <b>Notice:</b> This project is not affiliated with any official organization and does not take responsibility for the information provided.
            <button onClick={() => setShowDisclaimer(false)} style={{marginLeft: 16}}>Dismiss</button>
          </div>
        </div>
      )}
      <div className="ax2025-header">
        <div className="ax2025-tabs">
          {DATES.map((d: string) => (
            <button
              key={d}
              className={d === date ? "active" : ""}
              onClick={() => setDate(d)}
            >
              {d.replace(", 2025", "")}
            </button>
          ))}
        </div>
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
      
      <div className="ax2025-calendar">
        {editMode ? (
          <div className="ax2025-edit">
            <div className="ax2025-calendar-table">
              <div
                className="ax2025-calendar-header"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `auto repeat(${rooms.length}, minmax(160px, 1fr))`,
                }}
              >
                <div className="ax2025-calendar-timecol" style={{gridColumn: '1/2'}}></div>
                {rooms.map((room: string) => {
                  const shortRoom = room.length > 16 ? room.slice(0, 16) + '…' : room;
                  return (
                    <div
                      key={room}
                      className="ax2025-calendar-room ax2025-room-header"
                      title={room}
                    >
                      <span className="ax2025-room-label">{shortRoom}</span>
                      {room.length > 16 && (
                        <span className="ax2025-room-full">{room}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="ax2025-calendar-body" style={{ 
                display: 'grid',
                gridTemplateColumns: `auto repeat(${rooms.length}, minmax(160px, 1fr))`,
                gridAutoRows: 'auto'
              }}>
                {/* Render time slots */}
                {slots.map((t, slotIndex) => (
                  <div
                    className="ax2025-calendar-row"
                    key={t}
                    style={{
                      gridColumn: '1/2',
                      gridRow: slotIndex + 1,
                    }}
                  >
                    <div className="ax2025-calendar-timecol">
                      {formatTime(t)}
                    </div>
                  </div>
                ))}
                
                {/* Render events in rooms */}
                {rooms.map((room, roomIndex) => {
                  // Track which slots are already occupied by multi-slot events
                  const occupiedSlots = new Set<number>();
                  
                  return slots.map((t, slotIndex) => {
                    // Skip if this slot is already occupied by a multi-slot event
                    if (occupiedSlots.has(slotIndex)) {
                      return null;
                    }
                    
                    // Find event that starts at this slot in this room
                    const ev = events.find(
                      (e: Event) =>
                        e.panelRoom === room &&
                        parseTime(e.start) === t
                    );
                    
                    if (!ev) {
                      // If no event starts here, check if any event is ongoing
                      const ongoingEv = events.find(
                        (e: Event) =>
                          e.panelRoom === room &&
                          parseTime(e.start) < t &&
                          parseTime(e.end) > t
                      );
                      
                      // If no ongoing event, render empty cell
                      if (!ongoingEv) {
                        return (
                          <div 
                            key={`${room}-${t}`}
                            style={{
                              gridColumn: roomIndex + 2,
                              gridRow: slotIndex + 1,
                            }}
                            className="ax2025-time-gridline"
                          ></div>
                        );
                      }
                      
                      return null; // Skip, as this slot will be covered by multi-slot event
                    }
                    
                    // Calculate how many slots this event spans
                    const span = calculateEventSpan(ev, slots);
                    
                    // Mark slots as occupied for the duration of this event
                    for (let i = 0; i < span; i++) {
                      occupiedSlots.add(slotIndex + i);
                    }
                    
                    const id = getEventId(ev);
                    const sel = selected.has(id);
                    const overlap = sel && isOverlapping(ev);
                    
                    return (
                      <div
                        key={id}
                        className={
                          "ax2025-event" +
                          (sel ? " selected" : "") +
                          (overlap ? " ax2025-collision" : "") +
                          (span > 1 ? " multi-slot" : "")
                        }
                        tabIndex={0}
                        onClick={() => {
                          const next: Set<string> = new Set(selected);
                          if (sel) next.delete(id);
                          else next.add(id);
                          setSelected(next);
                        }}
                        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                          if (e.key === "Enter" || e.key === " ") {
                            const next: Set<string> = new Set(selected);
                            if (sel) next.delete(id);
                            else next.add(id);
                            setSelected(next);
                          }
                        }}
                        onDoubleClick={() => setPopup(ev)}
                        aria-label={ev.title}
                        title={ev.title}
                        style={{
                          gridColumn: roomIndex + 2,
                          gridRow: `${slotIndex + 1} / span ${span}`,
                          "--slot-span": span,
                        } as React.CSSProperties}
                      >
                        <div className="ax2025-event-title">{ev.title}</div>
                        {span > 1 && (
                          <div className="ax2025-event-time">
                            {ev.start} - {ev.end}
                          </div>
                        )}
                        {overlap && (
                          <div className="ax2025-warning">Overlap!</div>
                        )}
                      </div>
                    );
                  }).filter(Boolean);
                })}
              </div>
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
              <input
                type="text"
                placeholder="Paste base64 to import"
                onBlur={(e) => {
                  if (e.target.value) importSelection(e.target.value);
                }}
              />
              <button onClick={syncToGoogle} disabled={!googleFormUrl}>Sync Google</button>
              <button onClick={() => setShowSettings(true)} style={{ marginLeft: '8px' }}>
                Google Settings
              </button>
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
                  if (parseTime(lastEvent.end) <= eventStart) {
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
                <div className="ax2025-calendar-table">
                  <div
                    className="ax2025-calendar-header"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `auto repeat(${numColumns}, minmax(160px, 1fr))`,
                    }}
                  >
                    <div className="ax2025-calendar-timecol" style={{gridColumn: '1/2'}}></div>
                    {columns.map((_, colIdx) => (
                      <div 
                        key={colIdx}
                        className="ax2025-calendar-room ax2025-room-header"
                      >
                        My Events {numColumns > 1 ? `(${colIdx + 1})` : ''}
                      </div>
                    ))}
                  </div>
                  <div className="ax2025-calendar-body" style={{ 
                    display: 'grid',
                    gridTemplateColumns: `auto repeat(${numColumns}, minmax(160px, 1fr))`,
                    gridAutoRows: 'minmax(40px, auto)',
                    position: 'relative',
                  }}>
                    {/* Add time slot markers */}
                    {slots.map((t, idx) => (
                      <div 
                        key={`gridline-${t}`}
                        className="ax2025-time-gridline"
                        style={{
                          gridColumn: `1 / span ${numColumns + 1}`,
                          gridRow: idx + 1,
                          borderBottom: '1px solid #e0e0e0',
                          pointerEvents: 'none',
                          zIndex: 1,
                        }}
                      />
                    ))}
                    
                    {/* Render time column */}
                    {slots.map((t, idx) => (
                      <div 
                        key={`time-${t}`}
                        className="ax2025-calendar-timecol"
                        style={{
                          gridColumn: 1,
                          gridRow: idx + 1,
                          position: 'relative',
                          zIndex: 2,
                          height: '100%',
                        }}
                      >
                        {formatTime(t)}
                      </div>
                    ))}
                    
                    {/* Render each column of events */}
                    {columns.map((column, colIdx) => 
                      column.map(ev => {
                        // Find the row where this event starts
                        const startSlotIndex = slots.findIndex(t => 
                          parseTime(ev.start) <= t && t < parseTime(ev.end)
                        );
                        
                        if (startSlotIndex === -1) return null;
                        
                        // Calculate span - how many slots this event covers
                        const span = slots.filter(t => 
                          t >= parseTime(ev.start) && t < parseTime(ev.end)
                        ).length;
                        
                        // Ensure minimum span of 1
                        const finalSpan = Math.max(1, span);
                        
                        const rowStart = startSlotIndex + 1;
                        
                        return (
                          <div
                            key={getEventId(ev)}
                            className={`ax2025-event selected ${finalSpan > 1 ? 'multi-slot' : ''}`}
                            tabIndex={0}
                            onClick={() => setPopup(ev)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                              if (e.key === "Enter" || e.key === " ") setPopup(ev);
                            }}
                            aria-label={ev.title}
                            title={ev.title}
                            style={{
                              gridColumn: colIdx + 2,
                              gridRow: `${rowStart} / span ${finalSpan}`,
                              "--slot-span": finalSpan,
                              zIndex: 3, // Make sure events are above grid lines
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
              <input
                type="text"
                placeholder="Paste base64 to import"
                onBlur={(e) => {
                  if (e.target.value) importSelection(e.target.value);
                }}
              />
              <button onClick={syncToGoogle} disabled={!googleFormUrl}>Sync Google</button>
              <button onClick={() => setShowSettings(true)} style={{ marginLeft: '8px' }}>
                Google Settings
              </button>
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
    </div>
  );
}

export default App;
