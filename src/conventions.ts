import type { Event } from "./events";

export interface ConventionMeta {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface Convention extends ConventionMeta {
  events: Event[];
  roomColumnWidth?: number;
  _renameMap?: Record<string, string>;
  _deletedEvents?: string[];
}

const BASE = import.meta.env.BASE_URL;

export interface ConventionListResponse {
  conventions: ConventionMeta[];
  defaultId?: string;
}

export async function fetchConventionList(): Promise<ConventionListResponse> {
  const res = await fetch(`${BASE}conventions.json`);
  if (!res.ok) throw new Error("Failed to fetch conventions list");
  const data = await res.json();
  // Handle both old format (plain array) and new format ({ conventions, defaultId })
  if (Array.isArray(data)) {
    return { conventions: data };
  }
  return data;
}

export async function fetchConvention(id: string): Promise<Convention> {
  const res = await fetch(`${BASE}convention/${encodeURIComponent(id)}.json`);
  if (!res.ok) throw new Error(`Failed to fetch convention: ${id}`);
  const data = await res.json();
  return { ...data, id };
}

/**
 * Generate all date strings between startDate and endDate (inclusive).
 * Date strings are in "Month Day, Year" format (e.g. "July 3, 2025").
 */
export function generateDates(startDate: string, endDate: string): string[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(
      current.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    );
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/**
 * Strip the year from a date string for display in tabs.
 * e.g. "July 3, 2025" → "July 3"
 */
export function stripYear(dateStr: string): string {
  return dateStr.replace(/,\s*\d{4}$/, "");
}
