function doPost(e) {
  try {
    const action = e.parameter.action;
    if (action !== 'sync') {
      return ContentService.createTextOutput("Invalid action").setMimeType(ContentService.MimeType.TEXT);
    }

    const jsonData = e.parameter.data;
    const eventIdList = JSON.parse(jsonData);

    const events = new Map();

    for (const eventId of eventIdList) {
      if (EventDB.has(eventId)) {
        const event = EventDB.get(eventId)
        events.set(event.title, event)
      }
    }

    const calendarName = "AX2025 Events";
    const calendar = getOrCreateCalendar(calendarName);

    // Remove all events in the future (optionally all events)
    const now = new Date();
    const futureEvents = calendar.getEvents(now, new Date(now.getFullYear() + 1, 11, 31)); // 1 year range
    for (const event of futureEvents) {
      const title = event.getTitle()
      if (!events.has(title)) {
        // event no longer needed
        event.deleteEvent();
      } else {
        // already has this event
        events.delete(title)
      }
    }

    // Add all events from the list
    for (const [title, ev] of events) {
      // Expecting: { title, description, location, start, end } format
      const start = parseDateTimeInPST(ev.date, ev.start);
      const end = parseDateTimeInPST(ev.date, ev.end);
      calendar.createEvent(
        title || "Untitled Event",
        start,
        end,
        {
          description: ev.panelDescription || "",
          location: ev.panelRoom || ""
        }
      );
    }
    
    return ContentService.createTextOutput("Sync complete: " + JSON.stringify(eventIdList)).setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    return ContentService.createTextOutput("Error: " + err.message).setMimeType(ContentService.MimeType.TEXT);
  }
}

function getOrCreateCalendar(name) {
  const calendars = CalendarApp.getCalendarsByName(name);
  for (const cal of calendars) {
    if (cal.getName() === name && cal.isOwnedByMe()) {
      return cal;
    }
  }
  return CalendarApp.createCalendar(name, {
    timeZone: "America/Los_Angeles"
  });
}

// Combine "July 6, 2025" + " " + "3:00 PM" + " PT" → Date object
function parseDateTimeInPST(dateStr, timeStr) {
  const fullStr = `${dateStr} ${timeStr} PDT`;
  return new Date(fullStr);
}
