import { Cause } from 'effect';

export type ActivityFaultKind = 'defect' | 'degraded';

export type ActivityDefectNote = {
  readonly type: 'defect';
  readonly place: string;
  readonly fingerprint: string;
  readonly message: string;
  readonly stack: string;
};

export type ActivityDegradedNote = {
  readonly type: 'degraded';
  readonly place: string;
  readonly why: string;
  readonly fingerprint: string;
  readonly message: string;
  readonly stack: string;
};

export type ActivityFaultNote = ActivityDefectNote | ActivityDegradedNote;

const MESSAGE_CHARS = 1_000;
const STACK_CHARS = 3_000;
const FINGERPRINT_CHARS = 400;

const told = new WeakSet<object>();

export function defectNote(place: string, cause: Cause.Cause<unknown>): ActivityDefectNote | null {
  const found = Cause.findDefect(cause);
  if (found._tag === 'Failure' || !firstTelling(found.success)) return null;
  return { type: 'defect', place, ...described(place, found.success, cause) };
}

export function degradedNote(place: string, why: string, cause: Cause.Cause<unknown>): ActivityDegradedNote {
  const found = Cause.findDefect(cause);
  const defect = found._tag === 'Success' ? found.success : Cause.squash(cause);
  firstTelling(defect);
  return { type: 'degraded', place, why, ...described(place, defect, cause) };
}

function firstTelling(defect: unknown): boolean {
  if (typeof defect !== 'object' || defect === null) return true;
  if (told.has(defect)) return false;
  told.add(defect);
  return true;
}

function described(place: string, defect: unknown, cause: Cause.Cause<unknown>) {
  const message = defect instanceof Error ? defect.message : String(defect);
  return {
    fingerprint: `${place}\n${message.replace(VARYING, '#')}`.slice(0, FINGERPRINT_CHARS),
    message: message.slice(0, MESSAGE_CHARS),
    stack: Cause.pretty(cause).slice(0, STACK_CHARS),
  };
}

const VARYING = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|\b[0-9a-f]*\d[0-9a-f]*\b/gi;
