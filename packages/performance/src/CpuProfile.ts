import * as Schema from 'effect/Schema';

export const CPU_PROFILE_OPERATIONS = ['connect', 'enable', 'start', 'stop', 'disable', 'disconnect'] as const;
export const cpuProfileOperationSchema = Schema.Literals(CPU_PROFILE_OPERATIONS);
export type CpuProfileOperation = typeof cpuProfileOperationSchema.Type;

const storedRequestFields = {
  requestedBy: Schema.String.check(Schema.isMinLength(1)),
  requestedDurationMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
} as const;

export const storedProfileRequestSchema = Schema.Struct(storedRequestFields);

export const CPU_PROFILE_CAPTURE_MAX_MS = 300_000;

export const cpuProfileRequestSchema = Schema.Struct({
  requestedBy: storedRequestFields.requestedBy,
  requestedDurationMs: Schema.Finite.check(Schema.isGreaterThan(0)).check(Schema.isLessThanOrEqualTo(CPU_PROFILE_CAPTURE_MAX_MS)),
});
export type CpuProfileRequest = typeof cpuProfileRequestSchema.Type;

export const cpuProfileArtifactSchema = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      callFrame: Schema.Struct({
        functionName: Schema.String,
        url: Schema.String,
        lineNumber: Schema.Number,
      }),
      children: Schema.optional(Schema.Array(Schema.Number)),
    }),
  ),
  startTime: Schema.Number,
  endTime: Schema.Number,
  samples: Schema.Array(Schema.Number),
  timeDeltas: Schema.Array(Schema.Number),
}).pipe(
  Schema.check(
    Schema.makeFilter((profile) => {
      if (profile.samples.length !== profile.timeDeltas.length) {
        return 'CPU profile samples and timeDeltas must have equal length.';
      }
      const ids = new Set(profile.nodes.map((node) => node.id));
      if (ids.size !== profile.nodes.length) return 'CPU profile node ids must be unique.';
      if (profile.samples.some((id) => !ids.has(id))) return 'CPU profile samples must name retained nodes.';
      if (profile.nodes.some((node) => node.children?.some((id) => !ids.has(id)))) {
        return 'CPU profile children must name retained nodes.';
      }
      const children = new Map(profile.nodes.map((node) => [node.id, node.children ?? []]));
      const complete = new Set<number>();
      const active = new Set<number>();
      for (const node of profile.nodes) {
        const pending: Array<readonly [number, boolean]> = [[node.id, false]];
        while (pending.length > 0) {
          const [id, exiting] = pending.pop()!;
          if (exiting) {
            active.delete(id);
            complete.add(id);
            continue;
          }
          if (complete.has(id)) continue;
          if (active.has(id)) return 'CPU profile children must not form a cycle.';
          active.add(id);
          pending.push([id, true]);
          for (const child of children.get(id) ?? []) pending.push([child, false]);
        }
      }
      return undefined;
    }),
  ),
);
export type CpuProfileArtifact = typeof cpuProfileArtifactSchema.Type;

export const cpuProfileFrameSchema = Schema.Struct({
  functionName: Schema.String,
  url: Schema.String,
  lineNumber: Schema.Number,
  selfMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  totalMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  samples: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type CpuProfileFrame = typeof cpuProfileFrameSchema.Type;

function samplingPeriod(profile: CpuProfileArtifact): number {
  const positive = profile.timeDeltas.filter((delta) => delta > 0).sort((left, right) => left - right);
  return positive[Math.floor(positive.length / 4)] ?? 0;
}

function sampleWeights(profile: CpuProfileArtifact): number[] {
  const period = samplingPeriod(profile);
  return profile.timeDeltas.map((delta) => Math.min(Math.max(0, delta), period) / 1_000);
}

export function profileFrames(profile: CpuProfileArtifact): CpuProfileFrame[] {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map<number, number>();
  const samples = new Map<number, number>();
  const weights = sampleWeights(profile);
  for (let index = 0; index < profile.samples.length; index += 1) {
    const id = profile.samples[index]!;
    self.set(id, (self.get(id) ?? 0) + weights[index]!);
    samples.set(id, (samples.get(id) ?? 0) + 1);
  }

  const total = (rootId: number): number => {
    const visited = new Set<number>();
    const pending = [rootId];
    let durationMs = 0;
    while (pending.length > 0) {
      const id = pending.pop();
      if (id === undefined || visited.has(id)) continue;
      visited.add(id);
      durationMs += self.get(id) ?? 0;
      for (const child of nodes.get(id)?.children ?? []) pending.push(child);
    }
    return durationMs;
  };

  const frames = new Map<string, CpuProfileFrame>();
  for (const node of profile.nodes) {
    const { functionName, url, lineNumber } = node.callFrame;
    const key = JSON.stringify([functionName, url, lineNumber]);
    const current = frames.get(key);
    if (current === undefined) {
      frames.set(key, {
        functionName,
        url,
        lineNumber,
        selfMs: self.get(node.id) ?? 0,
        totalMs: total(node.id),
        samples: samples.get(node.id) ?? 0,
      });
      continue;
    }
    frames.set(key, {
      ...current,
      selfMs: current.selfMs + (self.get(node.id) ?? 0),
      totalMs: current.totalMs + total(node.id),
      samples: current.samples + (samples.get(node.id) ?? 0),
    });
  }

  return [...frames.values()].sort(
    (left, right) =>
      right.selfMs - left.selfMs ||
      right.totalMs - left.totalMs ||
      compareText(left.functionName, right.functionName) ||
      compareText(left.url, right.url) ||
      left.lineNumber - right.lineNumber,
  );
}

export const stallFrameSchema = Schema.Struct({
  functionName: Schema.String,
  url: Schema.String,
  lineNumber: Schema.Number,
  selfMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  samples: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type StallFrame = typeof stallFrameSchema.Type;

export const stallSamplingSchema = Schema.Struct({
  samples: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sampledMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  frame: Schema.NullOr(stallFrameSchema),
});
export type StallSampling = typeof stallSamplingSchema.Type;

export type ProfileInterval = { readonly monotonicStart: number; readonly monotonicEnd: number };

const RUN_PERIODS = 4;

export function stallSampling(profile: CpuProfileArtifact, window: ProfileInterval, interval: ProfileInterval): StallSampling | undefined {
  const span = profile.endTime - profile.startTime;
  const wall = window.monotonicEnd - window.monotonicStart;
  if (span <= 0 || wall <= 0) return undefined;
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const frames = new Map<string, StallFrame>();
  const run = RUN_PERIODS * samplingPeriod(profile);
  let samples = 0;
  let sampledMs = 0;
  let inside = false;
  let sampleTime = profile.startTime;
  for (let index = 0; index < profile.samples.length; index += 1) {
    const delta = profile.timeDeltas[index]!;
    sampleTime += delta;
    const monotonic = window.monotonicStart + ((sampleTime - profile.startTime) / span) * wall;
    const after = inside;
    inside = monotonic >= interval.monotonicStart && monotonic <= interval.monotonicEnd;
    if (!inside) continue;
    const callFrame = nodes.get(profile.samples[index]!)?.callFrame;
    if (callFrame === undefined) continue;
    const key = JSON.stringify([callFrame.functionName, callFrame.url, callFrame.lineNumber]);
    const current = frames.get(key);
    const selfMs = after && delta <= run ? (Math.max(0, delta) * wall) / span : 0;
    samples += 1;
    sampledMs += selfMs;
    frames.set(
      key,
      current === undefined
        ? { ...callFrame, selfMs, samples: 1 }
        : { ...current, selfMs: current.selfMs + selfMs, samples: current.samples + 1 },
    );
  }
  const top = [...frames.values()].sort(
    (left, right) =>
      right.selfMs - left.selfMs ||
      right.samples - left.samples ||
      compareText(left.functionName, right.functionName) ||
      compareText(left.url, right.url) ||
      left.lineNumber - right.lineNumber,
  )[0];
  const held = sampledMs * 2 >= interval.monotonicEnd - interval.monotonicStart;
  return { samples, sampledMs, frame: top !== undefined && held ? top : null };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const isCpuProfileArtifact = Schema.is(cpuProfileArtifactSchema);
const storedCpuProfileArtifactSchema = Schema.Json.pipe(
  Schema.check(
    Schema.makeFilter((profile) =>
      isCpuProfileArtifact(profile) ? undefined : 'CPU profile payload is not a standard inspector artifact.',
    ),
  ),
);

export const cpuProfilePayloadSchema = Schema.Struct({
  ...storedRequestFields,
  profile: storedCpuProfileArtifactSchema,
});
export type CpuProfilePayload = typeof cpuProfilePayloadSchema.Type;

export const cpuProfileReadPayloadSchema = Schema.Struct({
  ...storedRequestFields,
  profile: Schema.optional(storedCpuProfileArtifactSchema),
});
export type CpuProfileReadPayload = typeof cpuProfileReadPayloadSchema.Type;
