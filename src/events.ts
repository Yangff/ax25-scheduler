// Event type definition
export type Event = {
  title: string;
  panelRoom: string;
  start: string; // e.g. "10:00 AM"
  end: string;   // e.g. "10:50 AM"
  panelDescription: string;
  ticket: boolean;
  date: string; // e.g. "July 3, 2025"
};
