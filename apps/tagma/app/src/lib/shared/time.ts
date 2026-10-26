const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function minuteStart(now: number): number {
  return Math.floor(now / MINUTE) * MINUTE;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function timeAgo(iso: string, now = Date.now()): string {
  const then = new Date(iso);
  const diff = now - then.getTime();
  if (diff < MINUTE) return 'now';
  return timeAgoAbove(then, diff);
}

export const agoSaid = (iso: string): string => {
  const said = timeAgo(iso);
  return said === 'now' ? 'just now' : /^\d+[mhd]$/.test(said) ? `${said} ago` : `on ${said}`;
};

export function timeRunning(iso: string, now = Date.now()): string {
  const then = new Date(iso);
  const diff = now - then.getTime();
  if (diff < MINUTE) return `${Math.max(0, Math.floor(diff / 1000))}s`;
  return timeAgoAbove(then, diff);
}

export function timeCompact(iso: string, now = Date.now(), ticking = false): string {
  const then = new Date(iso);
  const diff = now - then.getTime();
  if (diff < MINUTE) return ticking ? `${Math.max(0, Math.floor(diff / 1000))}s` : 'now';
  if (diff < 7 * DAY) return timeAgoAbove(then, diff);
  if (diff < 365 * DAY) return `${Math.floor(diff / (7 * DAY))}w`;
  return `${Math.floor(diff / (365 * DAY))}y`;
}

function timeAgoAbove(then: Date, diff: number): string {
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  const date = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === new Date().getFullYear() ? date : `${date}, ${then.getFullYear()}`;
}
