export function callDuration(milliseconds: number): string {
  const ms = Math.max(0, milliseconds);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

export function elapsedDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const secondsPart = `${String(seconds % 60).padStart(2, '0')}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${secondsPart}`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}m ${secondsPart}`;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function format(locale: string, shape: 'time' | 'day' | 'dated', options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${shape}\n${locale}`;
  let held = formats.get(key);
  if (held === undefined) {
    held = new Intl.DateTimeFormat(locale, options);
    formats.set(key, held);
  }
  return held;
}

export function messageTime(value: string | number, locale: string): string {
  return format(locale, 'time', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function dayLabel(value: string, locale: string): string {
  const date = new Date(value);
  return date.getFullYear() !== new Date().getFullYear()
    ? format(locale, 'dated', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
    : format(locale, 'day', { day: 'numeric', month: 'long' }).format(date);
}
