/**
 * IBVAP Timestamp Utilities
 * 
 * Backend stores all timestamps as UTC.
 * This file provides consistent IST (UTC+05:30) display formatting
 * for all timestamp fields in the IBVAP frontend.
 *
 * IMPORTANT:
 * - Backend returns naive UTC strings like "2026-09-04 05:12:31.482000"
 *   (without Z or +00:00 suffix).
 * - JavaScript's Date constructor treats these as LOCAL time unless we
 *   explicitly append 'Z' to signal UTC.
 * - New backend code returns timezone-aware strings ending with +00:00,
 *   which JS parses correctly as UTC.
 * - We handle both formats here.
 */

/** IST locale options for full datetime display */
const IST_FULL_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

/** IST locale options for time-only display */
const IST_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

/** IST locale options for short time display (HH:MM only) */
const IST_SHORT_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/**
 * Parse a backend timestamp string as UTC.
 *
 * Handles both:
 *   - "2026-09-04 05:12:31.482000"  (naive UTC — append Z)
 *   - "2026-09-04T05:12:31.482000+00:00"  (explicit UTC — parse as-is)
 *   - "2026-09-04T05:12:31.482000Z"  (explicit UTC — parse as-is)
 *
 * Returns a Date object representing the correct UTC moment.
 * Returns null if the input is falsy or invalid.
 */
export function parseUTCTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;

  let normalized = ts.trim();

  // If already has timezone indicator, parse directly
  if (normalized.endsWith('Z') || normalized.includes('+') && normalized.indexOf('+') > 10) {
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }

  // Replace space separator with T for ISO 8601 format
  normalized = normalized.replace(' ', 'T');

  // Append Z to signal UTC if no timezone indicator present
  if (!normalized.endsWith('Z') && !normalized.includes('+00:00')) {
    normalized = normalized + 'Z';
  }

  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a backend UTC timestamp as IST full datetime string.
 *
 * Example output: "04 Sep 2026, 10:42:31 IST"
 */
export function formatTimestampIST(ts: string | null | undefined): string {
  const d = parseUTCTimestamp(ts);
  if (!d) return ts || '—';

  const formatted = d.toLocaleString('en-IN', IST_FULL_OPTIONS);
  return `${formatted} IST`;
}

/**
 * Format a backend UTC timestamp as IST time-only string.
 *
 * Example output: "10:42:31 IST"
 */
export function formatTimeIST(ts: string | null | undefined): string {
  const d = parseUTCTimestamp(ts);
  if (!d) return ts || '—';

  const formatted = d.toLocaleString('en-IN', IST_TIME_OPTIONS);
  return `${formatted} IST`;
}

/**
 * Format a backend UTC timestamp as IST short time (HH:MM only).
 *
 * Example output: "10:42"
 */
export function formatShortTimeIST(ts: string | null | undefined): string {
  const d = parseUTCTimestamp(ts);
  if (!d) return ts || '—';

  return d.toLocaleString('en-IN', IST_SHORT_TIME_OPTIONS);
}

/**
 * Format seconds into MM:SS.mmm display (for source_video_timestamp_sec).
 *
 * Example: 14.533 → "00:14.533"
 */
export function formatVideoTimestamp(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '';
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
}
