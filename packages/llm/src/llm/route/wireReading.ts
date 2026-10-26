import type { WireAttempt, WireLastEvent } from '../schema/errors';

export interface WireReading {
  readonly attempt: number;
  readonly startedAt: number;
  status: number | undefined;
  upstreamRequestId: string | undefined;
  bytesRead: number;
  events: number;
  lastEventType: string | undefined;
  secrets: Iterable<string>;
}

export const openWireReading = (attempt: number, startedAt: number): WireReading => ({
  attempt,
  startedAt,
  status: undefined,
  upstreamRequestId: undefined,
  bytesRead: 0,
  events: 0,
  lastEventType: undefined,
  secrets: [],
});

export const lastEventOf = (reading: WireReading): WireLastEvent => ({
  type: reading.lastEventType,
  count: reading.events,
});

export const attemptFacts = (reading: WireReading, now: number): WireAttempt => ({
  status: reading.status,
  upstreamRequestId: reading.upstreamRequestId,
  attempt: reading.attempt,
  bytesRead: reading.bytesRead,
  elapsedMs: now - reading.startedAt,
  lastEvent: lastEventOf(reading),
});

export const sawEvent = (reading: WireReading, type: string) => {
  reading.events += 1;
  reading.lastEventType = type;
};
