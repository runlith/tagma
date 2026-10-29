import { rename } from 'node:fs/promises';
import type * as Trace from '@paulirish/trace_engine';
import { type CpuProfileArtifact, profileFrames } from '@runlith/performance/CpuProfile';
import { INSIGHTS, type HotFunction, type InsightDetail, type InsightSet, type Lcp, type TraceSummary } from '../contract/wire/trace.js';
import { bounded, msOf, type Origin, tell } from './insights.js';
import { type AnalysisAnswer, type AnalysisAsk, type SetDetail, SETS_KEPT } from './sidecar.js';
import { eventSplitter } from './splitter.js';

declare const self: Worker;

const HOT_KEPT = 200;

const UNRANKED = new Set(['(root)', '(idle)', '(program)']);

class Rect {
  constructor(
    readonly x = 0,
    readonly y = 0,
    readonly width = 0,
    readonly height = 0,
  ) {}
  get top() {
    return Math.min(this.y, this.y + this.height);
  }
  get left() {
    return Math.min(this.x, this.x + this.width);
  }
  get bottom() {
    return Math.max(this.y, this.y + this.height);
  }
  get right() {
    return Math.max(this.x, this.x + this.width);
  }
}

type Parsed = Trace.TraceModel.ParsedTrace;
type Window = Trace.Insights.Types.InsightSet;
type Raw = Trace.Handlers.ModelHandlers.Samples.ProfileData['rawProfile'];

const readEvents = async (file: string): Promise<Trace.Types.Events.Event[]> => {
  const events: Trace.Types.Events.Event[] = [];
  const splitter = eventSplitter((batch) => {
    for (const event of batch) events.push(event as Trace.Types.Events.Event);
  });
  const reader = Bun.file(file).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    splitter.push(value);
  }
  splitter.end();
  return events;
};

const mainProfiles = (parsed: Parsed, set: Window): Raw[] => {
  const { Meta, Samples } = parsed.data;
  const overlaps = (window: Trace.Types.Timing.TraceWindowMicro) => window.min <= set.bounds.max && window.max >= set.bounds.min;
  const framed = [...(Meta.rendererProcessesByFrame.get(set.frameId) ?? [])]
    .filter(([, windows]) => windows.some((held) => overlaps(held.window)))
    .map(([pid]) => pid);
  const processes = framed.length > 0 ? framed : [...Meta.topLevelRendererIds];
  return processes.flatMap((pid) =>
    [...(Meta.threadsInProcess.get(pid) ?? [])]
      .filter(([, named]) => named.args.name === 'CrRendererMain')
      .flatMap(([tid]) => {
        const held = Samples.profilesInProcess.get(pid)?.get(tid);
        return held === undefined ? [] : [held.rawProfile];
      }),
  );
};

const windowed = (profiles: readonly Raw[], set: Window): CpuProfileArtifact => {
  const nodes: CpuProfileArtifact['nodes'][number][] = [];
  const samples: number[] = [];
  const timeDeltas: number[] = [];
  let offset = 0;
  for (const profile of profiles) {
    const children = new Map<number, number[]>();
    for (const node of profile.nodes) {
      const parent = 'parent' in node ? node.parent : undefined;
      if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), node.id]);
    }
    let top = 0;
    for (const node of profile.nodes) {
      const below = [...(node.children ?? []), ...(children.get(node.id) ?? [])];
      nodes.push({
        id: offset + node.id,
        callFrame: { functionName: node.callFrame.functionName, url: node.callFrame.url, lineNumber: node.callFrame.lineNumber },
        children: [...new Set(below)].map((id) => offset + id),
      });
      top = Math.max(top, node.id);
    }
    let ts = profile.startTime;
    const ids = profile.samples ?? [];
    const deltas = profile.timeDeltas ?? [];
    for (let index = 0; index < ids.length; index += 1) {
      ts += deltas[index] ?? 0;
      if (ts < set.bounds.min || ts > set.bounds.max) continue;
      samples.push(offset + ids[index]!);
      timeDeltas.push(deltas[index] ?? 0);
    }
    offset += top + 1;
  }
  return { nodes, startTime: set.bounds.min, endTime: set.bounds.max, samples, timeDeltas };
};

const hotOf = (parsed: Parsed, set: Window): HotFunction[] =>
  profileFrames(windowed(mainProfiles(parsed, set), set))
    .filter((frame) => !UNRANKED.has(frame.functionName) && frame.selfMs > 0)
    .slice(0, HOT_KEPT)
    .map((frame) => ({
      function: bounded(frame.functionName === '' ? '(anonymous)' : frame.functionName),
      url: bounded(frame.url),
      line: frame.lineNumber < 0 ? 0 : frame.lineNumber + 1,
      selfMs: Math.round(frame.selfMs * 10) / 10,
      totalMs: Math.round(frame.totalMs * 10) / 10,
    }));

const lcpOf = (set: Window): Lcp | null => {
  const model = set.model.LCPBreakdown;
  if (model?.lcpMs === undefined) return null;
  const node = model.lcpEvent?.args.data;
  const parts = model.subparts;
  return {
    ms: Math.round(model.lcpMs * 10) / 10,
    element: node?.nodeName ?? node?.type ?? null,
    url: model.lcpRequest === undefined ? null : bounded(model.lcpRequest.args.data.url),
    phases:
      parts === undefined
        ? null
        : {
            ttfb: msOf(parts.ttfb.range),
            loadDelay: parts.loadDelay === undefined ? null : msOf(parts.loadDelay.range),
            loadDuration: parts.loadDuration === undefined ? null : msOf(parts.loadDuration.range),
            renderDelay: msOf(parts.renderDelay.range),
          },
  };
};

const setOf = (parsed: Parsed, set: Window, origin: Origin): { readonly set: InsightSet; readonly detail: SetDetail } => {
  const insights: InsightDetail[] = INSIGHTS.flatMap((name) => {
    const model = set.model[name];
    if (model === undefined) return [];
    const told = tell(name, model as never, origin);
    return [{ insight: name, state: model.state, line: told.line, lines: told.lines }];
  });
  const inp = set.model.INPBreakdown?.highPercentileInteractionEvent;
  const cls = set.model.CLSCulprits;
  return {
    set: {
      id: set.id,
      url: bounded(String(set.url)),
      startMs: msOf(set.bounds.min - origin.micro),
      durationMs: msOf(set.bounds.range),
      lcp: lcpOf(set),
      inpMs: inp === undefined ? null : msOf(inp.dur),
      cls: cls === undefined ? null : Math.round((cls.worstCluster?.clusterCumulativeScore ?? 0) * 1_000) / 1_000,
      failed: insights.filter((held) => held.state === 'fail').map((held) => ({ insight: held.insight, line: held.line })),
    },
    detail: { id: set.id, insights, hot: hotOf(parsed, set) },
  };
};

const written = async (file: string, value: unknown, id: number): Promise<void> => {
  const staging = `${file}.${id}.part`;
  await Bun.write(staging, JSON.stringify(value));
  await rename(staging, file);
};

const analyze = async (ask: AnalysisAsk): Promise<AnalysisAnswer> => {
  (globalThis as { DOMRect?: unknown }).DOMRect ??= Rect;
  const Engine = await import('@paulirish/trace_engine');
  const model = Engine.TraceModel.Model.createWithAllHandlers();
  await model.parse(await readEvents(ask.file), {
    metadata: {
      cpuThrottling: ask.metadata.cpuThrottling,
      ...(ask.metadata.networkThrottling === null ? {} : { networkThrottling: ask.metadata.networkThrottling }),
      ...(ask.metadata.network === null ? {} : { networkThrottlingConditions: ask.metadata.network }),
    },
  });
  const parsed = model.parsedTrace();
  if (parsed === null) return { id: ask.id, failed: 'the trace engine parsed no trace from the file' };
  const bounds = parsed.data.Meta.traceBounds;
  const origin = { micro: bounds.min };
  const windows = [...(parsed.insights ?? new Map<string, Window>()).values()];
  const kept = windows.slice(0, SETS_KEPT).map((set) => setOf(parsed, set, origin));
  for (const [index, held] of kept.entries()) await written(ask.set.replace('{n}', String(index)), held.detail, ask.id);
  const summary: TraceSummary = {
    ...ask.recorded,
    durationMs: msOf(bounds.range),
    sets: kept.map((held) => held.set),
    setsTotal: windows.length,
  };
  await written(ask.summary, { version: 2, ...summary }, ask.id);
  return { id: ask.id, summary };
};

self.addEventListener('message', (event: MessageEvent<AnalysisAsk>) => {
  const ask = event.data;
  analyze(ask).then(
    (answer) => self.postMessage(answer),
    (cause: unknown) =>
      self.postMessage({ id: ask.id, failed: cause instanceof Error ? cause.message : String(cause) } satisfies AnalysisAnswer),
  );
});

self.postMessage({ id: 0, ready: true } satisfies AnalysisAnswer);
