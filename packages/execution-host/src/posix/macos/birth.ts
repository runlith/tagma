import { ProcessesUnreadable } from '../../ProcessReader';

export const birthOf = (seconds: number | bigint, micros: number | bigint): string => `${seconds}:${micros}`;

const parts = (birth: string): readonly [bigint, bigint] | ProcessesUnreadable => {
  const matched = /^(0|[1-9]\d{0,19}):(0|[1-9]\d{0,5})$/u.exec(birth);
  if (matched === null) return new ProcessesUnreadable({ detail: 'the birth is not a native macOS seconds:microseconds witness' });
  const seconds = BigInt(matched[1]!);
  if (seconds > 18_446_744_073_709_551_615n) return new ProcessesUnreadable({ detail: 'the birth seconds exceed the native counter' });
  return [seconds, BigInt(matched[2]!)];
};

export const compareBirth = (left: string, right: string): number | ProcessesUnreadable => {
  const a = parts(left);
  if (a instanceof ProcessesUnreadable) return a;
  const b = parts(right);
  if (b instanceof ProcessesUnreadable) return b;
  const [secondsA, microsA] = a;
  const [secondsB, microsB] = b;
  return secondsA < secondsB ? -1 : secondsA > secondsB ? 1 : microsA < microsB ? -1 : microsA > microsB ? 1 : 0;
};

export const bornBetween = (birth: string, fromMs: number, untilMs: number): boolean | ProcessesUnreadable => {
  const parsed = parts(birth);
  if (parsed instanceof ProcessesUnreadable) return parsed;
  const from = Math.ceil(fromMs * 1000);
  const until = Math.floor(untilMs * 1000);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) || from > until)
    return new ProcessesUnreadable({ detail: 'the accounting interval cannot be compared to the native birth' });
  const [seconds, micros] = parsed;
  const start = seconds * 1_000_000n + micros;
  return start >= BigInt(from) && start <= BigInt(until);
};
