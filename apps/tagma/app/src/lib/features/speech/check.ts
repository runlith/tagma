import type { Heard, TrackPhase } from '@tagma/server/speech/contract/wire/listening';
import type { DevicesStatus } from '@tagma/server/speech/contract/wire/status';

export type Source = 'mic' | 'system';

export const SILENCE_DB = -60;
export const FRAMES_MS = 3_000;
export const SILENCE_MS = 5_000;
export const QUEUE_MS = 3_000;
const LINES_KEPT = 60;
const GAPS_KEPT = 20;

export type TrackView = {
  readonly id: string;
  readonly phase: TrackPhase | null;
  readonly queuedMs: number | null;
  readonly queueRose: boolean;
  readonly retryInMs: number | null;
  readonly reason: string | null;
  readonly peak: number;
  readonly rms: number;
  readonly levelAt: number | null;
  readonly quietSince: number | null;
};

export type Said = {
  readonly key: string;
  readonly track: string;
  readonly closed: boolean;
  readonly text: string;
  readonly hypothesis: string;
  readonly revision: number;
  readonly speaker: number | null;
};

export type Gap = Extract<Heard, { kind: 'gap' }>;

export type Run = {
  readonly tracks: Readonly<Record<string, TrackView>>;
  readonly said: readonly Said[];
  readonly gaps: readonly Gap[];
};

export const emptyRun: Run = { tracks: {}, said: [], gaps: [] };

export const levelDb = (amplitude: number): number => (amplitude <= 0 ? -Infinity : 20 * Math.log10(amplitude));

export const levelFill = (amplitude: number): number => Math.max(0, Math.min(1, (levelDb(amplitude) - SILENCE_DB) / -SILENCE_DB));

const fresh = (id: string): TrackView => ({
  id,
  phase: null,
  queuedMs: null,
  queueRose: false,
  retryInMs: null,
  reason: null,
  peak: 0,
  rms: 0,
  levelAt: null,
  quietSince: null,
});

const settled = (said: readonly Said[], next: Said): readonly Said[] => {
  const at = said.findIndex((one) => one.key === next.key);
  if (at < 0) return [...said, next].slice(-LINES_KEPT);
  const known = said[at]!;
  return next.revision < known.revision ? said : said.map((one, index) => (index === at ? next : one));
};

export function apply(run: Run, heard: Heard, now: number): Run {
  switch (heard.kind) {
    case 'level': {
      const before = run.tracks[heard.track] ?? fresh(heard.track);
      const loud = levelDb(heard.peak) > SILENCE_DB;
      const view: TrackView = {
        ...before,
        peak: heard.peak,
        rms: heard.rms,
        levelAt: now,
        quietSince: loud ? null : (before.quietSince ?? now),
      };
      return { ...run, tracks: { ...run.tracks, [heard.track]: view } };
    }
    case 'track': {
      const before = run.tracks[heard.track] ?? fresh(heard.track);
      const view: TrackView = {
        ...before,
        phase: heard.phase,
        queuedMs: heard.queuedMs,
        queueRose: heard.queuedMs !== null && before.queuedMs !== null && heard.queuedMs > before.queuedMs,
        retryInMs: heard.retryInMs,
        reason: heard.reason,
      };
      return { ...run, tracks: { ...run.tracks, [heard.track]: view } };
    }
    case 'utterance':
      return {
        ...run,
        said: settled(run.said, {
          key: `${heard.track}/${heard.segment}/${heard.seq}`,
          track: heard.track,
          closed: heard.closed,
          text: heard.text,
          hypothesis: heard.hypothesis,
          revision: heard.revision,
          speaker: heard.speaker,
        }),
      };
    case 'gap':
      return { ...run, gaps: [...run.gaps, heard].slice(-GAPS_KEPT) };
    case 'state':
      return run;
  }
}

const TERMINAL: readonly TrackPhase[] = ['finished', 'ended', 'failed'];

const ended = (view: TrackView): boolean => view.phase !== null && TERMINAL.includes(view.phase);

export const over = (run: Run, asked: number): boolean => Object.values(run.tracks).filter(ended).length >= asked;

export type Fault =
  | { readonly kind: 'no-capability'; readonly said: string; readonly details: readonly string[] }
  | { readonly kind: 'permission'; readonly state: 'denied' | 'unknown' }
  | { readonly kind: 'no-frames' }
  | { readonly kind: 'silence' }
  | { readonly kind: 'recognizer-not-ready'; readonly retryInMs: number | null }
  | { readonly kind: 'queue-growing'; readonly queuedMs: number }
  | { readonly kind: 'provider-error'; readonly reason: string };

export function readiness(source: Source, devices: DevicesStatus): Fault | null {
  if (devices.availability._tag === 'absent') {
    return {
      kind: 'no-capability',
      said: devices.said ?? devices.availability.reason,
      details: [devices.availability.reason, ...devices.availability.unblock],
    };
  }
  if (!devices.capabilities[source]) {
    return { kind: 'no-capability', said: `This Mac cannot record ${source === 'mic' ? 'a microphone' : 'system audio'}.`, details: [] };
  }
  const state = devices.permissions?.[source];
  return state === 'denied' || state === 'unknown' ? { kind: 'permission', state } : null;
}

export function fault(view: TrackView | undefined, startedAt: number, now: number): Fault | null {
  const sinceStart = now - startedAt;
  if (view?.phase === 'failed') return { kind: 'provider-error', reason: view.reason ?? 'The provider reported no reason.' };
  if (view !== undefined && ended(view)) return null;
  if (view?.phase === 'waiting') return { kind: 'recognizer-not-ready', retryInMs: view.retryInMs };
  if (view?.queuedMs != null && view.queuedMs >= QUEUE_MS && view.queueRose) return { kind: 'queue-growing', queuedMs: view.queuedMs };
  if (view?.phase === 'connecting' && sinceStart >= FRAMES_MS) return { kind: 'recognizer-not-ready', retryInMs: view.retryInMs };
  if (view?.levelAt == null ? sinceStart >= FRAMES_MS : now - view.levelAt >= FRAMES_MS) return { kind: 'no-frames' };
  if (view?.quietSince != null && now - view.quietSince >= SILENCE_MS) return { kind: 'silence' };
  return null;
}
