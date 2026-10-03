// Fixed names: ICU versions disagree on en-GB abbreviations ("Sep" vs "Sept").
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WINDOW_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/** "2026-09-28 08:00" -> "Mon 28 Sep 2026, 08:00". Labels are Netherlands local time. */
export function formatWindow(label: string): string {
  const m = WINDOW_RE.exec(label);
  if (!m) return label;
  const [, y, mo, d, h, mi] = m;
  // Use UTC purely as a calendar so the weekday does not depend on the viewer's zone.
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  return `${WEEKDAYS[date.getUTCDay()]} ${+d} ${MONTHS[+mo - 1]} ${y}, ${h}:${mi}`;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' });
}

export const km = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n * 10) / 10} km`;

export const pct = (share: number) => `${Math.round(share * 100)}%`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
