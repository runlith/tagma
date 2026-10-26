import { formatWithOptions } from 'node:util';

const FORMAT = { colors: false, breakLength: Infinity } as const;

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

export const instantOf = (at: Date): string => {
  const offset = -at.getTimezoneOffset();
  const away = Math.abs(offset);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}${offset < 0 ? '-' : '+'}${pad(Math.floor(away / 60))}:${pad(away % 60)}`;
};

export const recordLines = (text: string, at: Date, pid: number): string => {
  const stamp = `${instantOf(at)} [pid ${pid}] `;
  return text
    .split('\n')
    .map((line) => `${stamp}${line}`)
    .join('\n');
};

type Printer = (...args: unknown[]) => void;

export type RecordConsole = {
  log: Printer;
  info: Printer;
  debug: Printer;
  warn: Printer;
  error: Printer;
};

export const recordConsole = (target: RecordConsole, pid: number, now: () => Date = () => new Date()): void => {
  const out = target.log.bind(target);
  const err = target.error.bind(target);
  const into =
    (write: Printer): Printer =>
    (...args) =>
      write('%s', recordLines(formatWithOptions(FORMAT, ...args), now(), pid));
  target.log = into(out);
  target.info = into(out);
  target.debug = into(out);
  target.warn = into(err);
  target.error = into(err);
};
