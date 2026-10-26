export type SegmenterSettings = {
  readonly start: number;
  readonly end: number;
  readonly minSpeechMs: number;
  readonly minSilenceMs: number;
  readonly preRollMs: number;
  readonly maxMs: number;
};

export const segmenterDefaults: SegmenterSettings = {
  start: 0.5,
  end: 0.35,
  minSpeechMs: 250,
  minSilenceMs: 600,
  preRollMs: 300,
  maxMs: 20_000,
};

export type Cut = {
  readonly from: number;
  readonly to: number;
  readonly cause: 'silence' | 'limit' | 'flush';
};

type Quiet = {
  readonly phase: 'quiet';
  readonly floor: number;
  readonly candidate: number | undefined;
};

type Speaking = {
  readonly phase: 'speech';
  readonly floor: number;
  readonly start: number;
  readonly quietSince: number | undefined;
  readonly lastQuiet: number | undefined;
};

export type SegmenterState = Quiet | Speaking;

export type Segmenter = {
  readonly settings: SegmenterSettings;
  readonly rate: number;
  readonly window: number;
};

const framesOf = (segmenter: Segmenter, ms: number) => Math.round((ms * segmenter.rate) / 1000);

export const quiet = (floor: number): SegmenterState => ({ phase: 'quiet', floor, candidate: undefined });

const speechStart = (segmenter: Segmenter, floor: number, from: number) =>
  Math.max(floor, from - framesOf(segmenter, segmenter.settings.preRollMs));

const step = (segmenter: Segmenter, state: SegmenterState, at: number, probability: number): [SegmenterState, Cut | undefined] => {
  const { settings, window } = segmenter;
  const end = at + window;
  if (state.phase === 'quiet') {
    if (probability < settings.end) return [{ ...state, candidate: undefined }, undefined];
    const candidate = state.candidate ?? (probability >= settings.start ? at : undefined);
    if (candidate === undefined) return [state, undefined];
    if (end - candidate < framesOf(segmenter, settings.minSpeechMs)) return [{ ...state, candidate }, undefined];
    const start = speechStart(segmenter, state.floor, candidate);
    return [{ phase: 'speech', floor: state.floor, start, quietSince: undefined, lastQuiet: undefined }, undefined];
  }
  const silent = probability < settings.end;
  const quietSince = silent ? (state.quietSince ?? at) : undefined;
  const lastQuiet = silent && at - state.start >= framesOf(segmenter, settings.minSpeechMs) ? at : state.lastQuiet;
  if (quietSince !== undefined && end - quietSince >= framesOf(segmenter, settings.minSilenceMs))
    return [quiet(quietSince), { from: state.start, to: quietSince, cause: 'silence' }];
  if (end - state.start >= framesOf(segmenter, settings.maxMs)) {
    const to = lastQuiet ?? end;
    const next: Speaking = { phase: 'speech', floor: to, start: to, quietSince: silent ? at : undefined, lastQuiet: undefined };
    return [next, { from: state.start, to, cause: 'limit' }];
  }
  return [{ ...state, quietSince, lastQuiet }, undefined];
};

export const feed = (
  segmenter: Segmenter,
  state: SegmenterState,
  at: number,
  values: ReadonlyArray<number>,
): [SegmenterState, ReadonlyArray<Cut>] => {
  const cuts: Array<Cut> = [];
  let current = state;
  for (let index = 0; index < values.length; index++) {
    const start = at + index * segmenter.window;
    if (start < current.floor) continue;
    const [next, cut] = step(segmenter, current, start, values[index] ?? 0);
    current = next;
    if (cut !== undefined) cuts.push(cut);
  }
  return [current, cuts];
};

export const reach = (segmenter: Segmenter, state: SegmenterState, evaluated: number): number => {
  if (state.phase === 'speech') return state.start;
  return speechStart(segmenter, state.floor, state.candidate ?? evaluated);
};

export const flush = (state: SegmenterState, at: number): [SegmenterState, ReadonlyArray<Cut>] => {
  if (state.phase === 'quiet') return [quiet(at), []];
  const to = state.quietSince ?? at;
  return [quiet(at), to > state.start ? [{ from: state.start, to, cause: 'flush' }] : []];
};
