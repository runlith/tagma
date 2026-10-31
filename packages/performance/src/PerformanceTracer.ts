import * as Cause from 'effect/Cause';
import * as Context from 'effect/Context';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Hex from 'effect/encoding/Hex';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import { CurrentCost } from './CostLedger.js';
import * as Layer from 'effect/Layer';
import * as Metric from 'effect/Metric';
import * as Option from 'effect/Option';
import * as Tracer from 'effect/Tracer';
import { PerformanceStore } from './store/store.js';
import { recordByteSize, type JsonValue, type PerformanceRecord } from './store/records.js';
import type { SpanPayload } from './protocol/records.js';
import type { SampledSpan, TraceHandover, TraceProducer } from './TraceSampler.js';
import { CurrentTraceSampler, KEEP_ONE_TRACE_IN, TRACE_BUFFER_BYTES } from './TraceSampler.js';

export type Options = {
  readonly instanceId: string;
  readonly recordFloorMicros: number;
  readonly keepOneTraceIn?: () => number;
  readonly units?: ReadonlySet<string>;
};

export type SpanRecord = PerformanceRecord<'span', SpanPayload>;

const ATTRIBUTE_ALLOWLIST = new Map<string, string>([
  ['runId', 'run.id'],
  ['run.id', 'run.id'],
  ['threadId', 'thread.id'],
  ['thread.id', 'thread.id'],
  ['fold', 'thread.fold'],
  ['thread.fold', 'thread.fold'],
  ['agentId', 'agent.id'],
  ['agent.id', 'agent.id'],
  ['stepNumber', 'step.number'],
  ['step.number', 'step.number'],
  ['toolName', 'tool.name'],
  ['tool.name', 'tool.name'],
  ['toolCallId', 'tool.call.id'],
  ['tool.call.id', 'tool.call.id'],
  ['executedBy', 'tool.executed_by'],
  ['tool.executed_by', 'tool.executed_by'],
  ['server', 'mcp.server'],
  ['mcp.server', 'mcp.server'],
  ['childThreadId', 'thread.child.id'],
  ['thread.child.id', 'thread.child.id'],
  ['envelopeId', 'envelope.id'],
  ['envelope.id', 'envelope.id'],
  ['intent', 'delivery.intent'],
  ['delivery.intent', 'delivery.intent'],
  ['senderThreadId', 'thread.sender.id'],
  ['thread.sender.id', 'thread.sender.id'],
  ['targetThreadId', 'thread.target.id'],
  ['thread.target.id', 'thread.target.id'],
  ['sourceThreadId', 'thread.source.id'],
  ['thread.source.id', 'thread.source.id'],
  ['branchThreadId', 'thread.branch.id'],
  ['thread.branch.id', 'thread.branch.id'],
  ['cut', 'fork.cut'],
  ['fork.cut', 'fork.cut'],
  ['step', 'workflow.step'],
  ['workflow.step', 'workflow.step'],
  ['db.system.name', 'db.system.name'],
  ['db.operation.name', 'db.operation.name'],
  ['db.collection.name', 'db.collection.name'],
  ['db.query.fingerprint', 'db.query.fingerprint'],
  ['db.query.summary', 'db.query.summary'],
  ['db.queue.ms', 'db.queue.ms'],
  ['db.exec.ms', 'db.exec.ms'],
  ['queue.ms', 'queue.ms'],
  ['openPath', 'thread.open.path'],
  ['thread.open.path', 'thread.open.path'],
  ['writersHeld', 'thread.snapshot.writers_held'],
  ['thread.snapshot.writers_held', 'thread.snapshot.writers_held'],
  ['transcriptPages', 'transcript.pages'],
  ['transcript.pages', 'transcript.pages'],
  ['transcriptStop', 'transcript.stop'],
  ['transcript.stop', 'transcript.stop'],
  ['db.readers.queued', 'db.readers.queued'],
  ['db.readers.busy', 'db.readers.busy'],
  ['db.reader.pid', 'db.reader.pid'],
  ['project', 'project'],
  ['narrowed', 'narrowed'],
  ['blocks', 'blocks'],
  ['anchors', 'anchors'],
  ['files', 'files'],
  ['candidates', 'candidates'],
  ['created', 'created'],
  ['resolved', 'resolved'],
  ['graphId', 'graph.id'],
  ['graph.id', 'graph.id'],
  ['actId', 'act.id'],
  ['act.id', 'act.id'],
  ['opKind', 'operation.kind'],
  ['operation.kind', 'operation.kind'],
  ['opIndex', 'operation.index'],
  ['operation.index', 'operation.index'],
  ['writtenBlocks', 'blocks.written'],
  ['blocks.written', 'blocks.written'],
  ['bodyBytes', 'body.bytes'],
  ['body.bytes', 'body.bytes'],
  ['rows', 'rows'],
  ['events', 'events'],
  ['bytes', 'bytes'],
  ['chunk.bytes', 'chunk.bytes'],
  ['records', 'records'],
  ['compressed', 'compressed'],
  ['outcome', 'outcome'],
  ['reason', 'reason'],
  ['encodeMs', 'encode.ms'],
  ['encode.ms', 'encode.ms'],
  ['writeMs', 'write.ms'],
  ['write.ms', 'write.ms'],
  ['route', 'http.route'],
  ['http.route', 'http.route'],
  ['status', 'http.response.status_code'],
  ['http.response.status_code', 'http.response.status_code'],
  ['requestId', 'http.request.id'],
  ['http.request.id', 'http.request.id'],
  ['generation', 'connection.generation'],
  ['connection.generation', 'connection.generation'],
  ['closeCause', 'connection.close.cause'],
  ['connection.close.cause', 'connection.close.cause'],
  ['executionId', 'execution.id'],
  ['execution.id', 'execution.id'],
  ['incarnation', 'host.incarnation'],
  ['host.incarnation', 'host.incarnation'],
  ['operationId', 'host.operation.id'],
  ['host.operation.id', 'host.operation.id'],
  ['role', 'host.role'],
  ['host.role', 'host.role'],
  ['connectionId', 'host.connection.id'],
  ['host.connection.id', 'host.connection.id'],
  ['refusal', 'host.refusal.kind'],
  ['host.refusal.kind', 'host.refusal.kind'],
  ['refusalReason', 'host.refusal.reason'],
  ['host.refusal.reason', 'host.refusal.reason'],
  ['budget', 'host.capacity.budget'],
  ['host.capacity.budget', 'host.capacity.budget'],
  ['requested', 'host.capacity.requested'],
  ['host.capacity.requested', 'host.capacity.requested'],
  ['limit', 'host.capacity.limit'],
  ['host.capacity.limit', 'host.capacity.limit'],
  ['cause', 'cause'],
  ['occasion', 'occasion'],
  ['lane', 'wire.lane'],
  ['wire.lane', 'wire.lane'],
  ['depth', 'wire.depth'],
  ['wire.depth', 'wire.depth'],
  ['kind', 'wire.kind'],
  ['wire.kind', 'wire.kind'],
  ['cells', 'presentation.cells'],
  ['presentation.cells', 'presentation.cells'],
  ['gate.op', 'gate.op'],
  ['gate.rules', 'gate.rules'],
  ['gate.inspections', 'gate.inspections'],
  ['gate.files', 'gate.files'],
  ['gate.ms', 'gate.ms'],
  ['gate.verdict', 'gate.verdict'],
  ['gate.programs', 'gate.programs'],
  ['gate.ready.ms', 'gate.ready.ms'],
  ['enforcement.rule', 'enforcement.rule'],
  ['inspection.builtin', 'inspection.builtin'],
  ['inspection.kind', 'inspection.kind'],
  ['inspection.lane', 'inspection.lane'],
  ['git.op', 'git.op'],
  ['checkout.root', 'checkout.root'],
  ['checkout.path', 'checkout.path'],
  ['checkout.reason', 'checkout.reason'],
  ['checkout.readers', 'checkout.readers'],
]);

const SPAN_DURATION_BOUNDARIES = Metric.exponentialBoundaries({ start: 0.5, factor: 2, count: 35 });

type Primitive = string | number | boolean | null;
type RawAttribute = Primitive | bigint | undefined;
type SpanOptions = Parameters<Tracer.Tracer['span']>[0];
type SpanMetrics = {
  readonly timer: Metric.Histogram<Duration.Duration>;
  readonly failures: Metric.Counter<number>;
  readonly nameBytes: number;
};

class PerformanceSpan implements Tracer.Span {
  readonly _tag = 'Span';
  readonly spanId = Hex.random(16);
  readonly traceId: string;
  readonly name: string;
  readonly parent: Option.Option<Tracer.AnySpan>;
  readonly annotations: Context.Context<never>;
  projected: Record<string, Primitive> | null;
  rawKeys: Array<string> | undefined;
  rawValues: Array<RawAttribute> | undefined;
  tail: SqlTail | undefined;
  rawBound = 0;
  attributeBytes = 0;
  private attributeCount = 0;
  readonly links: Array<Tracer.SpanLink>;
  readonly sampled: boolean;
  readonly kind: Tracer.SpanKind;
  readonly traceRoot: boolean;
  readonly unit: string | null;
  readonly enclosing: string | null;
  status: Tracer.SpanStatus;

  constructor(
    options: SpanOptions,
    units: ReadonlySet<string>,
    private readonly weigh: Weigher,
    private readonly onEnd: (span: PerformanceSpan, endTime: bigint, exit: Exit.Exit<unknown, unknown>) => void,
  ) {
    this.name = options.name;
    this.projected = options.name === 'sql.execute' ? null : {};
    this.parent = options.parent;
    this.annotations = options.annotations;
    this.links = options.links;
    this.sampled = options.sampled;
    this.kind = options.kind;
    const parent = Option.getOrUndefined(options.parent);
    this.traceId = parent?.traceId ?? Hex.random(32);
    this.traceRoot = parent === undefined || parent._tag === 'ExternalSpan';
    this.enclosing = parent instanceof PerformanceSpan ? parent.unit : null;
    this.unit = !this.traceRoot && units.has(options.name) ? this.spanId : this.enclosing;
    this.status = { _tag: 'Started', startTime: options.startTime };
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (this.status._tag === 'Ended') return;
    this.status = { _tag: 'Ended', startTime: this.status.startTime, endTime, exit: Exit.isSuccess(exit) ? Exit.void : exit };
    this.onEnd(this, endTime, exit);
  }

  get attributes(): ReadonlyMap<string, unknown> {
    const attributes = this.projected ?? this.tail?.attributes ?? projectRaw(this.rawKeys, this.rawValues);
    return new Map(Object.entries(attributes));
  }

  attribute(key: string, value: unknown): void {
    if (!this.sampled || this.status._tag === 'Ended') return;
    const target = ATTRIBUTE_ALLOWLIST.get(key);
    if (target === undefined) return;
    if (this.projected === null) {
      const raw = rawAttribute(value);
      const bound = attributeBound(target, raw);
      if (bound !== null && this.rawBound + bound <= TRACE_BUFFER_BYTES) {
        (this.rawKeys ??= []).push(key);
        (this.rawValues ??= []).push(raw);
        this.rawBound += bound;
        return;
      }
      this.projected = projectRaw(this.rawKeys, this.rawValues);
      this.rawKeys = undefined;
      this.rawValues = undefined;
      this.attributeCount = Object.keys(this.projected).length;
      this.attributeBytes = attributesByteSize(this.projected, this.weigh);
    }
    const encoded = projectAttribute(value);
    const previous = this.projected[target];
    if (encoded === undefined) {
      if (previous === undefined) return;
      delete this.projected[target];
      this.attributeCount -= 1;
      this.attributeBytes -= (this.attributeCount === 0 ? 0 : 1) + (TARGET_BYTES.get(target) ?? 0) + 1 + this.weigh(previous);
      return;
    }
    this.projected[target] = encoded;
    if (previous !== undefined) {
      this.attributeBytes += this.weigh(encoded) - this.weigh(previous);
      return;
    }
    this.attributeBytes += (this.attributeCount === 0 ? 0 : 1) + (TARGET_BYTES.get(target) ?? 0) + 1 + this.weigh(encoded);
    this.attributeCount += 1;
  }

  event(_name: string, _startTime: bigint, _attributes?: Record<string, unknown>): void {}

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    this.links.push(...links);
  }
}

class SqlTail implements SampledSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly spanKind: Tracer.SpanKind;
  readonly monotonicEnd: number;
  readonly root: boolean;
  readonly unit: string | null;
  readonly upperBytes: number;
  private keys: ReadonlyArray<string> | undefined;
  private values: ReadonlyArray<RawAttribute> | undefined;
  private projected: Record<string, Primitive> | undefined;
  private weight: number | undefined;

  constructor(
    span: PerformanceSpan,
    readonly exit: SpanPayload['exit'],
    readonly wallTime: number,
    readonly monotonicStart: number,
    durationMs: number,
    readonly durationMicros: number,
    readonly failed: boolean,
    readonly slow: boolean,
    private readonly baseBytes: number,
    private readonly weigh: Weigher,
  ) {
    this.traceId = span.traceId;
    this.spanId = span.spanId;
    this.parentId = Option.getOrUndefined(span.parent)?.spanId ?? null;
    this.name = span.name;
    this.spanKind = span.kind;
    this.monotonicEnd = monotonicStart + durationMs;
    this.root = span.traceRoot;
    this.unit = span.unit;
    this.keys = span.rawKeys;
    this.values = span.rawValues;
    this.upperBytes = baseBytes + span.rawBound;
    span.rawKeys = undefined;
    span.rawValues = undefined;
    span.tail = this;
  }

  get attributes(): Record<string, Primitive> {
    if (this.projected === undefined) {
      this.projected = projectRaw(this.keys, this.values);
      this.keys = undefined;
      this.values = undefined;
    }
    return this.projected;
  }

  get byteSize(): number {
    return (this.weight ??= this.baseBytes + attributesByteSize(this.attributes, this.weigh));
  }
}

export const make = Effect.fnUntraced(function* (options: Options) {
  const store = yield* PerformanceStore;
  const sampler = yield* CurrentTraceSampler;
  const metricContext = yield* Effect.context<never>();
  const metricsByName = new Map<string, SpanMetrics>();

  const recordFloorMicros = Math.max(0, Math.trunc(options.recordFloorMicros));
  const units = options.units ?? new Set<string>();
  const weigh = makeWeigher();

  const metricsFor = (name: string): SpanMetrics => {
    const existing = metricsByName.get(name);
    if (existing !== undefined) return existing;
    const metrics = {
      timer: Metric.timer(name, {
        boundaries: SPAN_DURATION_BOUNDARIES,
        attributes: { source: 'span', measure: 'duration' },
      }),
      failures: Metric.counter(name, {
        incremental: true,
        attributes: { source: 'span', measure: 'failure' },
      }),
      nameBytes: Buffer.byteLength(JSON.stringify(name)),
    };
    metricsByName.set(name, metrics);
    return metrics;
  };

  const isSlow = (metrics: SpanMetrics, durationMs: number, ceilingMs: number): boolean => {
    const state = metrics.timer.valueUnsafe(metricContext);
    if (state.count < SETTLED_ENDINGS) return durationMs >= ceilingMs;
    const target = state.count * 0.99;
    for (const [boundary, cumulative] of state.buckets) {
      if (cumulative >= target) return durationMs > boundary;
    }
    return false;
  };

  const submitTrace = (handover: TraceHandover) => {
    const floored = handover.keep === 'hash';
    store.openGroup(handover.traceId);
    for (const span of handover.spans) {
      if (floored && span.exit._tag === 'Success' && span.durationMicros < recordFloorMicros) continue;
      const record = spanRecord(span, options.instanceId);
      store.submit({ record, retentionKey: handover.traceId, byteSize: recordByteSize(record) });
    }
    store.closeGroup(handover.traceId);
  };

  const producer: TraceProducer = {
    keepOneTraceIn: () => Math.max(1, Math.trunc(options.keepOneTraceIn?.() ?? KEEP_ONE_TRACE_IN)),
    submit: submitTrace,
  };

  return Tracer.make({
    span(spanOptions) {
      const context = Fiber.getCurrent()?.context;
      const cost = context === undefined ? null : Context.get(context, CurrentCost);
      if (cost !== null) cost.counts.spans++;
      const wallTime = Date.now();
      const monotonicStart = performance.now();
      const span = new PerformanceSpan(spanOptions, units, weigh, (ended, endTime, exit) => {
        const durationNanos = endTime - spanOptions.startTime;
        const duration = Duration.nanos(durationNanos);
        const metrics = metricsFor(ended.name);
        metrics.timer.updateUnsafe(duration, metricContext);
        const failed = exit._tag === 'Failure' && !Cause.hasInterruptsOnly(exit.cause);
        if (failed) metrics.failures.updateUnsafe(1, metricContext);
        if (!ended.sampled) return;

        const durationMs = Duration.toMillis(duration);
        const durationMicros = Number(durationNanos) / 1_000;
        const heads = ended.unit !== null && ended.unit === ended.spanId;
        const slow = ended.traceRoot
          ? isSlow(metrics, durationMs, SLOW_ROOT_MS)
          : heads && isSlow(metrics, durationMs, Number.POSITIVE_INFINITY);
        const outcome: SpanPayload['exit'] =
          exit._tag === 'Success' ? SUCCESS_EXIT : { _tag: 'Failure', reasons: exit.cause.reasons.map((reason) => reason._tag) };
        const baseBytes = spanByteSize(metrics.nameBytes, 0, outcome);
        if (ended.projected === null) {
          sampler.end(new SqlTail(ended, outcome, wallTime, monotonicStart, durationMs, durationMicros, failed, slow, baseBytes, weigh));
          return;
        }
        const parent = Option.getOrUndefined(ended.parent);
        sampler.end({
          traceId: ended.traceId,
          spanId: ended.spanId,
          parentId: parent?.spanId ?? null,
          name: ended.name,
          spanKind: ended.kind,
          attributes: ended.projected,
          exit: outcome,
          wallTime,
          monotonicStart,
          monotonicEnd: monotonicStart + durationMs,
          durationMicros,
          failed,
          root: ended.traceRoot,
          unit: ended.unit,
          slow,
          byteSize: baseBytes + ended.attributeBytes,
        });
      });
      if (!span.sampled) return span;
      if (span.unit !== null && span.unit === span.spanId) {
        sampler.openUnit(span.traceId, producer, span.unit, span.enclosing);
      } else {
        sampler.open(span.traceId, producer, span.traceRoot, span.unit);
      }
      return span;
    },
  });
});

export const layer = (options: Options) => Layer.effect(Tracer.Tracer, make(options));

const SLOW_ROOT_MS = 250;

const SETTLED_ENDINGS = 100;

const SPAN_RECORD_ENVELOPE_BYTES = recordByteSize({
  id: 'f'.repeat(16),
  kind: 'span',
  instanceId: 'f'.repeat(36),
  wallTime: 1_726_000_000_000,
  monotonicStart: 1_234_567.891011,
  monotonicEnd: 1_234_567.891011,
  traceId: 'f'.repeat(32),
  parentId: 'f'.repeat(16),
  name: '',
  payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: {} },
});

const SUCCESS_BYTES = Buffer.byteLength(JSON.stringify({ _tag: 'Success' }));

const TARGET_BYTES = new Map(
  [...new Set(ATTRIBUTE_ALLOWLIST.values())].map((target) => [target, Buffer.byteLength(JSON.stringify(target))]),
);

const UNESCAPED_ASCII = /^[\x20\x21\x23-\x5b\x5d-\x7f]*$/u;

const SUCCESS_EXIT: SpanPayload['exit'] = Object.freeze({ _tag: 'Success' });

const STRING_WEIGHTS = 1024;
const STRING_WEIGHT_CHARS = 1024;
const BIGINT_BOUND = 10n ** 256n;

type Weigher = (value: Primitive) => number;

const makeWeigher = (): Weigher => {
  const stringWeights = new Map<string, number>();
  const stringBytes = (value: string): number => {
    if (value.length > STRING_WEIGHT_CHARS) return Buffer.byteLength(JSON.stringify(value));
    const known = stringWeights.get(value);
    if (known !== undefined) return known;
    const bytes = UNESCAPED_ASCII.test(value) ? value.length + 2 : Buffer.byteLength(JSON.stringify(value));
    if (stringWeights.size >= STRING_WEIGHTS) stringWeights.clear();
    stringWeights.set(value, bytes);
    return bytes;
  };
  return (value) => {
    if (value === null) return 4;
    if (typeof value === 'boolean') return value ? 4 : 5;
    if (typeof value === 'number') return String(value).length;
    return stringBytes(value);
  };
};

function spanByteSize(nameBytes: number, attributeBytes: number, exit: SpanPayload['exit']): number {
  return (
    SPAN_RECORD_ENVELOPE_BYTES +
    6 +
    nameBytes +
    (exit._tag === 'Success' ? SUCCESS_BYTES : Buffer.byteLength(JSON.stringify(exit))) +
    attributeBytes
  );
}

function spanRecord(span: SampledSpan, instanceId: string): SpanRecord {
  const payload: SpanPayload = {
    spanKind: span.spanKind,
    exit: span.exit,
    attributes: span.attributes,
  };
  return {
    id: span.spanId,
    kind: 'span',
    instanceId,
    wallTime: span.wallTime,
    monotonicStart: span.monotonicStart,
    monotonicEnd: span.monotonicEnd,
    traceId: span.traceId,
    parentId: span.parentId,
    name: span.name,
    payload,
  };
}

function rawAttribute(value: unknown): RawAttribute {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  return undefined;
}

function attributeBound(target: string, value: RawAttribute): number | null {
  let valueBytes = 0;
  if (typeof value === 'string') valueBytes = value.length * 6 + 2;
  else if (typeof value === 'number') valueBytes = 64;
  else if (typeof value === 'bigint') {
    if (value > BIGINT_BOUND || value < -BIGINT_BOUND) return null;
    valueBytes = 260;
  } else if (value === null) valueBytes = 4;
  else if (typeof value === 'boolean') valueBytes = 5;
  return Math.max(16, (TARGET_BYTES.get(target) ?? 0) + 2 + valueBytes);
}

function projectRaw(keys: ReadonlyArray<string> | undefined, values: ReadonlyArray<RawAttribute> | undefined): Record<string, Primitive> {
  const attributes: Record<string, Primitive> = {};
  if (keys === undefined || values === undefined) return attributes;
  for (let index = 0; index < keys.length; index += 1) {
    const target = ATTRIBUTE_ALLOWLIST.get(keys[index]!);
    if (target === undefined) continue;
    const value = projectAttribute(values[index]);
    if (value === undefined) delete attributes[target];
    else attributes[target] = value;
  }
  return attributes;
}

function attributesByteSize(attributes: Record<string, Primitive>, weigh: Weigher): number {
  let bytes = 0;
  let count = 0;
  for (const [key, value] of Object.entries(attributes)) {
    bytes += (count === 0 ? 0 : 1) + (TARGET_BYTES.get(key) ?? 0) + 1 + weigh(value);
    count += 1;
  }
  return bytes;
}

function projectAttribute(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return String(value);
  return undefined;
}
