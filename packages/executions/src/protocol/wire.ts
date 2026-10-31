import { Schema } from 'effect';
import { highestCommon, rangeText, WireRange } from './artifact';
import { CallBudget, CancellationCause } from './call';
import { CapabilityProfile, type ExecutionPolicy, HostGrant } from './capacity';
import { capabilityOf, needing, type Capability, type Served } from './capability';
import { CommandRevisionAnswer, CommandRevisionRequest, CommandSnapshot } from './command';
import {
  CommandBatch,
  CommandInventory,
  CommandQuery,
  CommandRefs,
  InventoryChanges,
  InventoryRevision,
  InventoryFeedItem,
} from './inventory';
import { CustodyAnswer, CustodyRequest } from './control';
import { BindingId, Principal } from './custody';
import { DeclaredPart, ListenerReport, LoadInterest, LoadReading, ProcessReport } from './evidence';
import { ExecutionRef, Incarnation, InstallationId, HostRequestRef } from './execution';
import { Refusal } from './host';
import { InputCause, InputAnswer, InputSequence } from './input';
import { InputProfile, InputRevision } from './inputProfile';
import { LaneInput, TerminalLane } from './lane';
import { CancelAnswer, LaunchRequest, StartAnswer } from './launch';
import { DisownReport, Disowned } from './keep';
import { Pace, PaceReport } from './pace';
import { FrameRevision, ScreenAnswer, ScreenPointAnswer, ScreenPointRead, ScreenRead, ScreenFeedItem } from './presentation';
import { ByteCursor, RecordRange, TerminalGeometry } from './record';
import { ProtocolFamily } from './family';
import { AdmissionPhase, ConnectionId, CustodianEpoch, HostCustody, HostCustodyRevision, Role } from './registration';
import { ForegroundAnswer } from './terminal';
import {
  CallAnswer,
  ExecutionPage,
  ExecutionSummary,
  OperationAnswer,
  PrepareAnswer,
  QuiescenceAnswer,
  QuiescenceTicket,
  ResumeAnswer,
  RetainedRecord,
  RuntimeStatus,
  YieldAnswer,
} from './runtime';
import {
  EndingMeasurement,
  EndingReceipt,
  ResidualEnding,
  ResidualInput,
  ProcessTarget,
  ProcessEnding,
  ShutdownAnswer,
  SignalAnswer,
  StopAction,
  StopReceipt,
} from './stop';

export const WIRE_VERSION = 41;
export const PREVIOUS_RELEASE = {
  version: 40,
  serves: [
    'machine-load',
    'end-residual',
    'end-process',
    'named-signals',
    'pipe-graceful-stop',
    'pace-raise',
    'terminal-foreground',
    'terminal-survives-holder',
    'pipe-survives-holder',
    'holder-replaces-itself',
    'screen-point',
  ],
} as const satisfies {
  readonly version: number;
  readonly serves: ReadonlyArray<Capability>;
};
export const WIRE_RANGE: WireRange = { min: WIRE_VERSION, max: WIRE_VERSION };

export const WIRE_MAGIC = 'runlith.executions.wire';

export const WirePreface = Schema.Struct({
  magic: Schema.Literal(WIRE_MAGIC),
  wire: WireRange,
});
export type WirePreface = typeof WirePreface.Type;

export const wireVersionOf = (parsed: unknown): number | undefined => {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const version = (parsed as { readonly v?: unknown }).v;
  return typeof version === 'number' && Number.isSafeInteger(version) && version > 0 ? version : undefined;
};

export const peekWireVersion = (header: string): number | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    return undefined;
  }
  return wireVersionOf(parsed);
};

export const wireSkewDetail = (standing: WireRange, own: WireRange): string =>
  `the host speaks wire version ${rangeText(standing)} and this client speaks ${rangeText(own)}`;

export const singleWire = (version: number): WireRange => ({ min: version, max: version });

const readPreface = Schema.decodeUnknownOption(Schema.fromJsonString(WirePreface));

export type ClientOpening =
  | { readonly _tag: 'Preface'; readonly agreed: number | undefined }
  | { readonly _tag: 'Unsupported'; readonly version: number }
  | { readonly _tag: 'Malformed' };

export const clientOpening = (header: string): ClientOpening => {
  const preface = readPreface(header);
  if (preface._tag === 'Some') {
    return { _tag: 'Preface', agreed: highestCommon(WIRE_RANGE, preface.value.wire) };
  }
  const version = peekWireVersion(header);
  return version === undefined ? { _tag: 'Malformed' } : { _tag: 'Unsupported', version };
};

const Positive = Schema.Int.check(Schema.isGreaterThan(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Share = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1));

export const RequestId = Count.pipe(Schema.brand('RequestId'));
export type RequestId = typeof RequestId.Type;

export const SubscriptionId = Count.pipe(Schema.brand('SubscriptionId'));
export type SubscriptionId = typeof SubscriptionId.Type;

export const WireLimits = Schema.Struct({
  frameBytes: Positive,
  headerBytes: Positive,
  connections: Positive,
  requests: Positive,
  subscriptions: Positive,
  credits: Positive,
  helloMs: Schema.optional(Positive),
});
export type WireLimits = typeof WireLimits.Type;

export const wireLimits = (
  profile: ExecutionPolicy,
  supplied: {
    readonly envelopeBytes: number;
    readonly connections: number;
    readonly requests: number;
    readonly subscriptions: number;
    readonly helloMs?: number;
  },
): WireLimits => ({
  frameBytes: frameSize(
    supplied.envelopeBytes,
    Math.max(profile.execution.read.chunkBytes, profile.execution.input.chunkBytes, profile.execution.frame.bytes),
  ),
  headerBytes: supplied.envelopeBytes,
  connections: supplied.connections,
  requests: supplied.requests,
  subscriptions: supplied.subscriptions,
  credits: frameSize(
    supplied.envelopeBytes,
    Math.max(profile.execution.read.readerCredits, profile.execution.frame.bytes * profile.execution.frame.inFlight),
  ),
  helloMs: supplied.helloMs,
});

export const BindingScope = Schema.Struct({
  binding: BindingId,
  principal: Principal,
});
export type BindingScope = typeof BindingScope.Type;

export const InputFrame = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Write'), bytes: Positive }),
  Schema.Struct({ _tag: Schema.Literal('Interrupt') }),
  Schema.Struct({ _tag: Schema.Literal('Resize'), geometry: TerminalGeometry }),
  Schema.Struct({ _tag: Schema.Literal('End') }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type InputFrame = typeof InputFrame.Type;

export const SubscriptionSource = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Bytes'), cursor: ByteCursor }),
  Schema.Struct({ _tag: Schema.Literal('State'), execution: ExecutionRef }),
  Schema.Struct({ _tag: Schema.Literal('Screen'), execution: ExecutionRef, base: Schema.optional(FrameRevision) }),
  Schema.Struct({ _tag: Schema.Literal('Inventory') }),
  Schema.Struct({ _tag: Schema.Literal('Inputs'), execution: ExecutionRef }),
  needing('machine-load', Schema.Struct({ _tag: Schema.Literal('Load'), serverPid: Positive, parts: Schema.Array(DeclaredPart) })),
  needing('screen-settled', Schema.Struct({ _tag: Schema.Literal('ScreenSettled'), execution: ExecutionRef, quietMs: Positive })),
]).pipe(Schema.toTaggedUnion('_tag'));
export type SubscriptionSource = typeof SubscriptionSource.Type;

export const AuthorityRequest = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('TakeHost'), operation: HostRequestRef, expected: HostCustodyRevision }),
  Schema.Struct({ _tag: Schema.Literal('FenceHost'), operation: HostRequestRef, expected: HostCustodyRevision }),
  Schema.Struct({ _tag: Schema.Literal('ReleaseHost'), operation: HostRequestRef, custody: HostCustody }),
  Schema.Struct({ _tag: Schema.Literal('OpenBinding'), principal: Principal }),
  Schema.Struct({ _tag: Schema.Literal('CloseBinding'), binding: BindingId, principal: Principal }),
  Schema.Struct({ _tag: Schema.Literal('Grant'), operation: HostRequestRef, share: Share }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type AuthorityRequest = typeof AuthorityRequest.Type;

export const AuthorityAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Held'), custody: HostCustody }),
  Schema.Struct({ _tag: Schema.Literal('Bound'), binding: BindingId, principal: Principal, epoch: CustodianEpoch }),
  Schema.Struct({ _tag: Schema.Literal('Unbound'), binding: BindingId }),
  Schema.Struct({ _tag: Schema.Literal('Stale'), expected: HostCustodyRevision, standing: HostCustody }),
  Schema.Struct({ _tag: Schema.Literal('Unresolved'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), refusal: Refusal }),
  Schema.Struct({
    _tag: Schema.Literal('Granted'),
    granted: HostGrant,
    reserved: Count,
    retained: Count,
    over: Count,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type AuthorityAnswer = typeof AuthorityAnswer.Type;

export const RetireAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Retired'), execution: ExecutionRef }),
  Schema.Struct({
    _tag: Schema.Literal('Refused'),
    execution: ExecutionRef,
    reason: Schema.Literals(['running', 'cleanup-unproven']),
    detail: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal('Unresolved'), execution: ExecutionRef, reads: Count }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type RetireAnswer = typeof RetireAnswer.Type;

const requests = [
  Schema.Struct({ _tag: Schema.Literal('Status') }),
  Schema.Struct({ _tag: Schema.Literal('List'), after: Schema.optional(ExecutionRef), limit: Positive }),
  Schema.Struct({ _tag: Schema.Literal('Changes'), since: InventoryRevision, limit: Positive }),
  Schema.Struct({ _tag: Schema.Literal('State'), execution: ExecutionRef }),
  Schema.Struct({
    _tag: Schema.Literal('Ending'),
    execution: ExecutionRef,
    remeasure: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ _tag: Schema.Literal('Command'), execution: ExecutionRef }),
  Schema.Struct({ _tag: Schema.Literal('Revise'), request: CommandRevisionRequest }),
  Schema.Struct({ _tag: Schema.Literal('Commands'), query: CommandQuery }),
  Schema.Struct({ _tag: Schema.Literal('CommandsAt'), refs: CommandRefs }),
  Schema.Struct({ _tag: Schema.Literal('Operation'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('CallResult'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('Start'), operation: HostRequestRef, launch: LaunchRequest }),
  Schema.Struct({
    _tag: Schema.Literal('CancelStart'),
    operation: HostRequestRef,
    cause: CancellationCause,
    trigger: Schema.NonEmptyString,
    when: Schema.Literals(['always', 'unadmitted']),
  }),
  Schema.Struct({ _tag: Schema.Literal('Read'), cursor: ByteCursor, limit: Positive }),
  Schema.Struct({ _tag: Schema.Literal('Subscribe'), source: SubscriptionSource, credits: Positive }),
  Schema.Struct({ _tag: Schema.Literal('Screen'), execution: ExecutionRef, ...ScreenRead.fields }),
  Schema.Struct({
    _tag: Schema.Literal('Input'),
    execution: ExecutionRef,
    scope: BindingScope,
    sequence: InputSequence,
    cause: InputCause,
    profile: Schema.optional(InputRevision),
    act: InputFrame,
  }),
  Schema.Struct({ _tag: Schema.Literal('OpenTerminalLane'), claim: BindingScope, execution: ExecutionRef }),
  Schema.Struct({ _tag: Schema.Literal('Signal'), execution: ExecutionRef, signal: Schema.NonEmptyString }),
  Schema.Struct({ _tag: Schema.Literal('Processes'), execution: ExecutionRef }),
  Schema.Struct({ _tag: Schema.Literal('Listeners'), execution: ExecutionRef }),
  Schema.Struct({ _tag: Schema.Literal('ListenerInventory') }),
  Schema.Struct({ _tag: Schema.Literal('Custody'), request: CustodyRequest, principal: Principal }),
  Schema.Struct({ _tag: Schema.Literal('Authority'), act: AuthorityRequest }),
  Schema.Struct({
    _tag: Schema.Literal('Stop'),
    operation: HostRequestRef,
    execution: ExecutionRef,
    cause: CancellationCause,
    action: StopAction,
    trigger: Schema.optional(Schema.String),
  }),
  Schema.Struct({ _tag: Schema.Literal('Retire'), operation: HostRequestRef, execution: ExecutionRef }),
  Schema.Struct({ _tag: Schema.Literal('Quiesce'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('Resume'), ticket: QuiescenceTicket }),
  Schema.Struct({ _tag: Schema.Literal('Prepare'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('Yield'), ticket: QuiescenceTicket }),
  Schema.Struct({ _tag: Schema.Literal('Shutdown'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('Pace'), pace: Pace }),
  Schema.Struct({ _tag: Schema.Literal('Disown'), disowned: Disowned }),
  Schema.Struct({ _tag: Schema.Literal('Retained'), execution: ExecutionRef }),
] as const;

export const Request = Schema.Union([
  ...requests,
  needing('machine-load', Schema.Struct({ _tag: Schema.Literal('LoadInterest'), subscription: SubscriptionId, ...LoadInterest.fields })),
  needing(
    'machine-load',
    Schema.Struct({ _tag: Schema.Literal('LoadParts'), subscription: SubscriptionId, parts: Schema.Array(DeclaredPart) }),
  ),
  needing('end-residual', Schema.Struct({ _tag: Schema.Literal('EndResidual'), ...ResidualInput.fields })),
  needing('end-process', Schema.Struct({ _tag: Schema.Literal('EndProcess'), target: ProcessTarget })),
  needing('terminal-foreground', Schema.Struct({ _tag: Schema.Literal('Foreground'), execution: ExecutionRef })),
  needing('screen-point', Schema.Struct({ _tag: Schema.Literal('ScreenPoint'), execution: ExecutionRef, ...ScreenPointRead.fields })),
]).pipe(Schema.toTaggedUnion('_tag'));
export type Request = typeof Request.Type;

export const requiredCapability = (body: Request): Capability | undefined =>
  capabilityOf(Request.cases[body._tag]) ??
  (body._tag === 'Subscribe' ? capabilityOf(SubscriptionSource.cases[body.source._tag]) : undefined);

export const unsupported = (body: Request, served: Served): Refusal | undefined => {
  const capability = requiredCapability(body);
  return capability === undefined ||
    (served.has(capability) && (capability !== 'machine-load' || (served.has('machine-load-parts') && served.has('machine-load-gpu'))))
    ? undefined
    : { _tag: 'UnsupportedCapability', capability, reason: `the host on this connection does not serve ${capability}` };
};

export const servedOn = (version: number, announcement: Served): Served =>
  version === WIRE_VERSION ? announcement : new Set(PREVIOUS_RELEASE.serves);

const CallHeading = Schema.Struct({
  _tag: Schema.Literal('Call'),
  request: RequestId,
  body: Schema.Struct({ _tag: Schema.String }),
});
const readCallHeading = Schema.decodeUnknownOption(CallHeading);

export type UnsupportedCall = {
  readonly request: RequestId;
  readonly refusal: Refusal;
};

export const unsupportedCall = (message: unknown): UnsupportedCall | undefined => {
  const heading = readCallHeading(message);
  if (heading._tag === 'None' || Object.hasOwn(Request.cases, heading.value.body._tag)) return undefined;
  return {
    request: heading.value.request,
    refusal: { _tag: 'UnsupportedCapability', reason: `the request ${heading.value.body._tag} is not one this host serves` },
  };
};

const answers = [
  Schema.Struct({ _tag: Schema.Literal('Status'), status: RuntimeStatus }),
  Schema.Struct({ _tag: Schema.Literal('Listed'), page: ExecutionPage }),
  Schema.Struct({ _tag: Schema.Literal('Changes'), changes: InventoryChanges }),
  Schema.Struct({ _tag: Schema.Literal('State'), summary: Schema.optional(ExecutionSummary) }),
  Schema.Struct({
    _tag: Schema.Literal('Ending'),
    receipt: Schema.optional(EndingReceipt),
    measurement: Schema.optional(EndingMeasurement),
  }),
  Schema.Struct({ _tag: Schema.Literal('Command'), snapshot: Schema.optional(CommandSnapshot) }),
  Schema.Struct({ _tag: Schema.Literal('Revise'), outcome: CommandRevisionAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Commands'), inventory: CommandInventory }),
  Schema.Struct({ _tag: Schema.Literal('CommandsAt'), batch: CommandBatch }),
  Schema.Struct({ _tag: Schema.Literal('Operation'), answer: OperationAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Call'), answer: CallAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Start'), outcome: StartAnswer }),
  Schema.Struct({ _tag: Schema.Literal('CancelStart'), outcome: CancelAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Read'), range: RecordRange, bytes: Count, modes: InputProfile }),
  Schema.Struct({ _tag: Schema.Literal('Subscribed'), subscription: SubscriptionId }),
  Schema.Struct({ _tag: Schema.Literal('Screen'), answer: ScreenAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Input'), outcome: InputAnswer }),
  Schema.Struct({ _tag: Schema.Literal('OpenTerminalLane'), ...TerminalLane.fields }),
  Schema.Struct({ _tag: Schema.Literal('Signal'), outcome: SignalAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Processes'), report: Schema.optional(ProcessReport) }),
  Schema.Struct({ _tag: Schema.Literal('Listeners'), report: Schema.optional(ListenerReport) }),
  Schema.Struct({ _tag: Schema.Literal('ListenerInventory'), report: ListenerReport }),
  Schema.Struct({ _tag: Schema.Literal('Custody'), outcome: CustodyAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Authority'), outcome: AuthorityAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Stop'), receipt: StopReceipt }),
  Schema.Struct({ _tag: Schema.Literal('Retire'), outcome: RetireAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Quiesce'), outcome: QuiescenceAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Resume'), outcome: ResumeAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Prepare'), outcome: PrepareAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Yield'), outcome: YieldAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Shutdown'), outcome: ShutdownAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Pace'), report: PaceReport }),
  Schema.Struct({ _tag: Schema.Literal('Disown'), report: DisownReport }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), refusal: Refusal }),
  Schema.Struct({ _tag: Schema.Literal('Retained'), record: Schema.optional(RetainedRecord) }),
] as const;

export const HostAnswer = Schema.Union([
  ...answers,
  needing('machine-load', Schema.Struct({ _tag: Schema.Literal('LoadInterest'), applied: Schema.Boolean })),
  needing('machine-load', Schema.Struct({ _tag: Schema.Literal('LoadParts'), applied: Schema.Boolean })),
  needing('end-residual', Schema.Struct({ _tag: Schema.Literal('EndResidual'), outcome: ResidualEnding })),
  needing('end-process', Schema.Struct({ _tag: Schema.Literal('EndProcess'), outcome: ProcessEnding })),
  needing('terminal-foreground', Schema.Struct({ _tag: Schema.Literal('Foreground'), outcome: ForegroundAnswer })),
  needing('screen-point', Schema.Struct({ _tag: Schema.Literal('ScreenPoint'), point: ScreenPointAnswer, bytes: Count })),
]).pipe(Schema.toTaggedUnion('_tag'));
export type HostAnswer = typeof HostAnswer.Type;

export const SubscriptionEnding = Schema.Literals(['completed', 'cancelled', 'gap', 'unavailable', 'closed']);
export type SubscriptionEnding = typeof SubscriptionEnding.Type;

const events = [
  Schema.Struct({ _tag: Schema.Literal('Bytes'), subscription: SubscriptionId, range: RecordRange, bytes: Count }),
  Schema.Struct({ _tag: Schema.Literal('State'), subscription: SubscriptionId, summary: ExecutionSummary }),
  Schema.Struct({ _tag: Schema.Literal('Screen'), subscription: SubscriptionId, update: ScreenFeedItem }),
  Schema.Struct({ _tag: Schema.Literal('Inventory'), subscription: SubscriptionId, update: InventoryFeedItem }),
  Schema.Struct({ _tag: Schema.Literal('Inputs'), subscription: SubscriptionId, ...LaneInput.fields }),
  needing('machine-load', Schema.Struct({ _tag: Schema.Literal('Load'), subscription: SubscriptionId, reading: LoadReading })),
  needing('screen-settled', Schema.Struct({ _tag: Schema.Literal('ScreenSettled'), subscription: SubscriptionId })),
  Schema.Struct({ _tag: Schema.Literal('Ended'), subscription: SubscriptionId, ending: SubscriptionEnding }),
] as const;
export const Event = Schema.Union(events).pipe(Schema.toTaggedUnion('_tag'));
export type Event = typeof Event.Type;

const EventHeading = Schema.Struct({
  _tag: Schema.Literal('Event'),
  body: Schema.Struct({ _tag: Schema.String, subscription: SubscriptionId }),
});
const readEventHeading = Schema.decodeUnknownOption(EventHeading);

export const unknownEvent = (message: unknown): SubscriptionId | undefined => {
  const heading = readEventHeading(message);
  return heading._tag === 'None' || Object.hasOwn(Event.cases, heading.value.body._tag) ? undefined : heading.value.body.subscription;
};

export const WireFault = Schema.Struct({
  kind: Schema.Literals([
    'oversized',
    'malformed',
    'unsupported-version',
    'unsupported-family',
    'unauthenticated',
    'already-authenticated',
    'connections-exceeded',
    'requests-exceeded',
    'subscriptions-exceeded',
    'credit-exceeded',
    'unknown-subscription',
    'unknown-request',
  ]),
  detail: Schema.String,
});
export type WireFault = typeof WireFault.Type;

export const fatalFault = (fault: WireFault): boolean =>
  fault.kind === 'oversized' || fault.kind === 'malformed' || fault.kind === 'unsupported-version';

const Hello = Schema.Struct({
  _tag: Schema.Literal('Hello'),
  request: RequestId,
  installation: InstallationId,
  protocol: ProtocolFamily,
  role: Role,
  secret: Schema.String,
  client: Schema.Struct({ name: Schema.NonEmptyString, version: Schema.NonEmptyString }),
});

const CallFields = {
  _tag: Schema.Literal('Call'),
  request: RequestId,
  installation: InstallationId,
  incarnation: Incarnation,
  epoch: CustodianEpoch,
};

const Credit = Schema.Struct({ _tag: Schema.Literal('Credit'), subscription: SubscriptionId, bytes: Positive });
const Unsubscribe = Schema.Struct({ _tag: Schema.Literal('Unsubscribe'), subscription: SubscriptionId });
const Cancel = Schema.Struct({ _tag: Schema.Literal('Cancel'), request: RequestId });

export const ClientMessage = Schema.Union([Hello, Schema.Struct({ ...CallFields, body: Request }), Credit, Unsubscribe, Cancel]).pipe(
  Schema.toTaggedUnion('_tag'),
);
export type ClientMessage = typeof ClientMessage.Type;

const Welcome = Schema.Struct({
  _tag: Schema.Literal('Welcome'),
  request: RequestId,
  connection: ConnectionId,
  role: Role,
  installation: InstallationId,
  incarnation: Incarnation,
  phase: AdmissionPhase,
  custody: HostCustody,
  profile: CapabilityProfile,
  limits: WireLimits,
  capabilities: Schema.optional(Schema.Array(Schema.NonEmptyString)),
});

const EventMessage = Schema.Struct({ _tag: Schema.Literal('Event'), body: Event });
const FaultMessage = Schema.Struct({ _tag: Schema.Literal('Fault'), request: Schema.optional(RequestId), fault: WireFault });

export const HostMessage = Schema.Union([
  Welcome,
  Schema.Struct({ _tag: Schema.Literal('Reply'), request: RequestId, body: HostAnswer }),
  EventMessage,
  FaultMessage,
]).pipe(Schema.toTaggedUnion('_tag'));
export type HostMessage = typeof HostMessage.Type;

export const FrameBody = Schema.Literals(['bytes', 'json']);
export type FrameBody = typeof FrameBody.Type;

const FrameVersion = Schema.Int.check(Schema.isBetween({ minimum: WIRE_RANGE.min, maximum: WIRE_RANGE.max }));
const payloadFrame = Schema.Struct({ v: FrameVersion, body: Schema.Literal('json') });

export const ClientFrame = Schema.Union([
  Schema.Struct({ v: FrameVersion, body: Schema.Literal('bytes'), message: ClientMessage }),
  payloadFrame,
]).pipe(Schema.toTaggedUnion('body'));
export type ClientFrame = typeof ClientFrame.Type;

export const HostFrame = Schema.Union([
  Schema.Struct({ v: FrameVersion, body: Schema.Literal('bytes'), message: HostMessage }),
  payloadFrame,
]).pipe(Schema.toTaggedUnion('body'));
export type HostFrame = typeof HostFrame.Type;

export const ClientMessageText = Schema.fromJsonString(ClientMessage);
export const HostMessageText = Schema.fromJsonString(HostMessage);

export const CallContext = Schema.Struct({
  budget: Schema.optional(CallBudget),
  scope: Schema.optional(BindingScope),
});
export type CallContext = typeof CallContext.Type;

export const SIZE_FIELD = 4;
export const HEADER_FIELD = 4;

export const frameSize = (headerLength: number, payloadLength: number): number => HEADER_FIELD + headerLength + payloadLength;
