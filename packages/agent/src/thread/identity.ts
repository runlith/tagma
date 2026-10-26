import { uuidv7 } from 'uuidv7';

export function mintThreadEventId(): string {
  return uuidv7();
}

export function mintThreadSignalId(): string {
  return uuidv7();
}

export function replayableThreadSignalId(...parts: readonly string[]): string {
  return parts.join(':');
}

export function mintThreadRunId(): string {
  return uuidv7();
}

export function mintThreadId(): string {
  return uuidv7();
}

export function mintThreadOwnerId(): string {
  return `thread-${uuidv7()}`;
}
