import type { JsonSchema } from '@runlith/llm/schema/ids';
import { type Message, ToolResultValue, toolInputSchema, type VendorWire } from '@runlith/llm/schema/messages';
import { schemaProperties } from '@runlith/llm/schema/readJsonSchema';
import { Data, Effect, Result, Schema, type SchemaAST } from 'effect';
import { jsonCodec } from '@runlith/utils/codec';
import { isRecord, type StructuredValue } from '@runlith/utils/object';
import type { PartialJsonState } from '@runlith/utils/json';
import type { Approval, AskedReason, PermissionOutcome, PermissionSubject, Raised } from '../permissions/vocabulary';
import { approvalLine } from '../modes/ApprovalMode';
import type { ToolDisplay } from '../tool/display';
import { refusalLines, refusalTail } from '../tool/refusal';
import type { CallProgress } from './callProgress';

export const DOOR_FIELDS = ['background', 'json'] as const;

export type DoorField = (typeof DOOR_FIELDS)[number];

export const DETACHED_DETAIL =
  'The call runs on in the background, owned by this thread rather than this turn. Its outcome reaches this thread as a notice when it ends; this turn need not wait for it.';

export const BACKGROUND_DETAIL =
  'The call has not run yet: it is prepared, asks for any permission it needs and waits its turn in the background, owned by this thread rather than this turn. Later calls that touch what it changes wait behind it. Its outcome — whether it ran or not — reaches this thread as a notice when it ends; this turn need not wait for it.';

const DOOR_FIELD_SAID: Readonly<Record<DoorField, string>> = {
  background: 'Answer at once; the outcome arrives later as a notice.',
  json: 'true — answer the document instead of the text.',
};

type ObjectSchema = { readonly type: 'object'; readonly properties?: Readonly<Record<string, unknown>> };

const objectSchema = (schema: unknown): schema is ObjectSchema =>
  typeof schema === 'object' && schema !== null && (schema as { readonly type?: unknown }).type === 'object';

const ownsAny = (schema: unknown, fields: readonly DoorField[]): boolean =>
  objectSchema(schema) && schema.properties !== undefined && fields.some((field) => field in schema.properties!);

const alternativesOf = (schema: unknown): readonly unknown[] | null => {
  if (typeof schema !== 'object' || schema === null) return null;
  const union = schema as Partial<{ readonly anyOf: unknown; readonly oneOf: unknown }>;
  const members = union.anyOf ?? union.oneOf;
  return Array.isArray(members) && members.length > 0 ? members : null;
};

export const offeringDoorFields = <S>(schema: S, fields: readonly DoorField[]): S | null => {
  const said = Object.fromEntries(fields.map((field) => [field, { type: 'boolean', description: DOOR_FIELD_SAID[field] }]));
  const offered = (member: ObjectSchema) => ({ ...member, properties: { ...(member.properties ?? {}), ...said } });
  const members = alternativesOf(schema);
  if (members === null) return objectSchema(schema) && !ownsAny(schema, fields) ? (offered(schema) as S) : null;
  if (ownsAny(schema, fields) || !members.every((member) => objectSchema(member) && !ownsAny(member, fields))) return null;
  const key = 'anyOf' in (schema as object) ? 'anyOf' : 'oneOf';
  return { ...schema, [key]: (members as readonly ObjectSchema[]).map(offered) } as S;
};

export const doorAsked = (input: unknown, field: DoorField): boolean | undefined => {
  if (typeof input !== 'object' || input === null) return undefined;
  const asked = (input as Readonly<Record<string, unknown>>)[field];
  return typeof asked === 'boolean' ? asked : undefined;
};

export const documentAsked = (tool: Tool | undefined, input: unknown): boolean =>
  tool?.doorFields?.includes('json') === true && doorAsked(input, 'json') === true;

export const withoutDoorFields = (input: unknown, fields: readonly DoorField[]): unknown => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  if (!fields.some((field) => field in input)) return input;
  return Object.fromEntries(Object.entries(input).filter(([key]) => !(fields as readonly string[]).includes(key)));
};
import type { ToolCaller, ToolCallerThread, ToolConfirmationFact } from './contracts';

export type ToolSchema<A = unknown> = Schema.Codec<A, unknown, never, never>;

export type ToolMedia = {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly label?: string;
};

export type ToolShown = {
  readonly path: string;
  readonly entry?: true;
  readonly as: 'read' | 'wrote' | 'found';
};

export const ToolRefusal = Schema.Struct({ code: Schema.String, reason: Schema.String, words: Schema.optional(Schema.String) });
export type ToolRefusal = typeof ToolRefusal.Type;

export type ToolRefusals = Readonly<Record<string, string>>;

export type ToolVerdict =
  | { readonly kind: 'answered' }
  | { readonly kind: 'refused'; readonly refusal: ToolRefusal }
  | { readonly kind: 'failed'; readonly error: string }
  | { readonly kind: 'denied' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unknown' };

export type ToolOutcome =
  | { readonly kind: 'answered'; readonly output: StructuredValue | undefined }
  | { readonly kind: 'refused'; readonly refusal: ToolRefusal; readonly output?: StructuredValue | undefined }
  | { readonly kind: 'failed'; readonly error: string; readonly output?: StructuredValue | undefined }
  | { readonly kind: 'denied'; readonly output?: StructuredValue | undefined }
  | { readonly kind: 'cancelled'; readonly output?: StructuredValue | undefined }
  | { readonly kind: 'unknown'; readonly output?: StructuredValue | undefined };

export function verdictOutcome(verdict: ToolVerdict, output: StructuredValue | undefined): ToolOutcome {
  switch (verdict.kind) {
    case 'answered':
      return { kind: 'answered', output };
    case 'refused':
      return { kind: 'refused', refusal: verdict.refusal, output };
    case 'failed':
      return { kind: 'failed', error: verdict.error, output };
    default:
      return { kind: verdict.kind, output };
  }
}

export function toolOutcomeFailed(kind: ToolOutcome['kind']): boolean {
  return kind === 'failed' || kind === 'refused' || kind === 'unknown';
}

export type ToolAnswerEnding = 'cancelled' | 'unknown';

export type ToolOutputSource = {
  readonly path: string;
  readonly byteLength: number;
  readonly lineCount: number;
  readonly format: 'json' | 'text';
  readonly retained?: () => void;
};

export type ToolAnswerOptions = {
  readonly source?: ToolOutputSource;
  readonly completion?: 'command';
  readonly media?: readonly ToolMedia[];
  readonly shown?: readonly ToolShown[];
  readonly text?: string;
} & (
  | { readonly refusal?: ToolRefusal; readonly ending?: never; readonly failure?: never }
  | { readonly ending: ToolAnswerEnding; readonly refusal?: never; readonly failure?: never }
  | { readonly failure?: string; readonly refusal?: never; readonly ending?: never }
);

export class ToolAnswer {
  readonly source: ToolOutputSource | undefined;
  readonly completion: 'command' | undefined;
  readonly media: readonly ToolMedia[];
  readonly shown: readonly ToolShown[];
  readonly text: string | undefined;
  readonly verdict: ToolVerdict;

  constructor(
    readonly value: unknown,
    readonly display: ToolDisplay | undefined,
    options: ToolAnswerOptions = {},
  ) {
    this.source = options.source;
    this.completion = options.completion;
    this.media = options.media ?? [];
    this.shown = options.shown ?? [];
    this.text = options.text;
    this.verdict =
      options.refusal !== undefined
        ? { kind: 'refused', refusal: options.refusal }
        : options.ending !== undefined
          ? { kind: options.ending }
          : options.failure !== undefined
            ? { kind: 'failed', error: options.failure }
            : { kind: 'answered' };
  }

  get options(): ToolAnswerOptions {
    const kept = { source: this.source, completion: this.completion, media: this.media, shown: this.shown, text: this.text };
    const verdict = this.verdict;
    if (verdict.kind === 'refused') return { ...kept, refusal: verdict.refusal };
    if (verdict.kind === 'failed') return { ...kept, failure: verdict.error };
    if (verdict.kind === 'cancelled' || verdict.kind === 'unknown') return { ...kept, ending: verdict.kind };
    return kept;
  }
}

export type ToolPreparationCall = {
  readonly toolCallId: string;
  readonly caller: ToolCaller;
};

export type ToolCallArrival = {
  readonly step?: number;
  readonly messages: readonly Message[];
  readonly progress?: CallProgress;
  readonly json?: boolean;
};

export type ToolCallIdentity = ToolPreparationCall & ToolCallArrival;

export type ToolCallOptions<P = undefined> = ToolCallIdentity &
  ([P] extends [undefined] ? { readonly prepared?: undefined } : { readonly prepared: P });

export function callerThread(caller: ToolCaller): Effect.Effect<ToolCallerThread, ToolFailed> {
  return caller.thread === null
    ? Effect.fail(new ToolFailed({ reason: 'This tool acts for a thread, and this call has none.' }))
    : Effect.succeed(caller.thread);
}

export type ToolReader = {
  readonly withinMs?: number;
};

export type ToolPreparation<P> = {
  readonly subjects: readonly PermissionSubject[];
  readonly raised?: readonly Raised[];
  readonly prepared?: P;
};

export type ClaimTarget =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'all' };

export type Claim = { readonly on: ClaimTarget; readonly access: 'read' | 'write' };

export type ToolClaims = (input: never, call: ToolPreparationCall) => Effect.Effect<readonly Claim[], ToolFailed>;

export const NO_CLAIMS = (): Effect.Effect<readonly Claim[]> => Effect.succeed([]);

const READS_ALL: readonly Claim[] = [{ on: { kind: 'all' }, access: 'read' }];

const WRITES_ALL: readonly Claim[] = [{ on: { kind: 'all' }, access: 'write' }];

export const everyClaim = (access: Claim['access']): readonly Claim[] => (access === 'read' ? READS_ALL : WRITES_ALL);

export class ToolFailed extends Data.TaggedError('Tool.Failed')<{
  readonly reason: string;
  readonly code?: string | undefined;
  readonly unblock?: readonly string[] | undefined;
  readonly words?: string | undefined;
}> {
  override get message(): string {
    const unblock = this.unblock ?? [];
    return (
      this.code === undefined ? [this.reason, ...refusalTail({ unblock })] : refusalLines({ code: this.code, reason: this.reason, unblock })
    ).join('\n');
  }

  get refusal(): ToolRefusal | null {
    return this.code === undefined ? null : { code: this.code, reason: this.reason, words: this.words };
  }

  get output(): StructuredValue | null {
    if (this.code === undefined) return null;
    return { status: 'refused', code: this.code, reason: this.reason, unblock: [...(this.unblock ?? [])] };
  }
}

export class ToolRefusalUndeclared extends Data.TaggedError('Tool.RefusalUndeclared')<{
  readonly code: string;
  readonly declared: readonly string[];
}> {
  override get message(): string {
    return `The tool failed with refusal ${this.code}, which it does not declare (it declares ${this.declared.length === 0 ? 'none' : this.declared.join(', ')}).`;
  }
}

const declaredFailure =
  (refusals: ToolRefusals) =>
  <A>(work: Effect.Effect<A, ToolFailed>): Effect.Effect<A, ToolFailed> =>
    Effect.tapError(work, (failure) =>
      failure.code === undefined || Object.hasOwn(refusals, failure.code)
        ? Effect.void
        : Effect.die(new ToolRefusalUndeclared({ code: failure.code, declared: Object.keys(refusals) })),
    );

const phrasedRefusal = (refusals: ToolRefusals, refusal: ToolRefusal): ToolRefusal =>
  refusal.words !== undefined || !Object.hasOwn(refusals, refusal.code) ? refusal : { ...refusal, words: refusals[refusal.code] };

const phrased =
  (refusals: ToolRefusals) =>
  <A>(work: Effect.Effect<A, ToolFailed>): Effect.Effect<A, ToolFailed> =>
    work.pipe(
      Effect.map((value) =>
        value instanceof ToolAnswer && value.verdict.kind === 'refused'
          ? (new ToolAnswer(value.value, value.display, {
              source: value.source,
              completion: value.completion,
              media: value.media,
              shown: value.shown,
              text: value.text,
              refusal: phrasedRefusal(refusals, value.verdict.refusal),
            }) as A)
          : value,
      ),
      Effect.mapError((failure) => {
        const refusal = failure.refusal;
        return refusal === null || refusal.words !== undefined
          ? failure
          : new ToolFailed({
              reason: failure.reason,
              code: failure.code,
              unblock: failure.unblock,
              words: phrasedRefusal(refusals, refusal).words,
            });
      }),
    );

export type ToolCallDispatchOptions = ToolCallIdentity & { readonly prepared?: unknown };

export type ToolExecute = (input: never, call: ToolCallDispatchOptions) => Effect.Effect<unknown, ToolFailed>;

export type ToolDispatch = (input: unknown, call: ToolCallDispatchOptions) => Effect.Effect<unknown, ToolFailed>;

export type ToolPrepare = (input: never, call: ToolPreparationCall) => Effect.Effect<ToolPreparation<unknown>, ToolFailed>;

export type ToolPrepareDispatch = (input: unknown, call: ToolPreparationCall) => Effect.Effect<ToolPreparation<unknown>, ToolFailed>;

export type ToolConfirmation = {
  summary: string;
  facts?: readonly ToolConfirmationFact[];
  consequence?: string;
};

export type ToolConfirmationDeclaration = {
  prompt(input: never, prepared?: unknown): ToolConfirmation;
  prepare?(input: never): Effect.Effect<ToolConfirmation, unknown>;
  confirmLabel: string;
  intent?: 'destructive';
};

export type ToolEffectSettlement<Output = unknown> =
  | { readonly status: 'completed'; readonly output: Output }
  | { readonly status: 'aborted' }
  | { readonly status: 'unknown' };

export type ToolSettleCall<TInput = unknown> = {
  readonly toolCallId: string;
  readonly toolInput: TInput;
  readonly caller: ToolCaller;
  readonly json?: boolean;
};

export type ToolInvocationDeclaration = {
  readonly approval: Approval;
  readonly mutates?: boolean;
  readonly confirmation?: ToolConfirmationDeclaration;
};

export type ToolDisplayProjection<TInput = unknown> = {
  readonly streamFields: readonly Extract<keyof TInput, string>[] | null;
  readonly project: (input: Partial<TInput>) => ToolDisplay;
};

export type ToolRecovery<TInput = unknown> = {
  readonly content: Extract<keyof TInput, string>;
  readonly destination?: Extract<keyof TInput, string>;
};

type InputRefusal = (error: Schema.SchemaError) => { readonly detail: string; readonly unblock: readonly string[] };

export const describedTool = (tool: {
  readonly description: string;
  readonly approval: Approval;
  readonly vendor?: VendorWire;
}): string => {
  const line = tool.vendor === undefined ? approvalLine(tool.approval) : '';
  return line === '' ? tool.description : `${tool.description}\n\n${line}`;
};

export type Tool = ToolInvocationDeclaration & {
  readonly inputRefusal?: InputRefusal;
  readonly parseOptions?: SchemaAST.ParseOptions;
  readonly description: string;
  readonly parameters: ToolSchema;
  readonly inputSchema: JsonSchema;
  readonly execute?: ToolExecute;
  readonly display: ToolDisplayProjection<Record<string, unknown>>;
  readonly recovery?: ToolRecovery<Record<string, unknown>>;
  readonly toModelOutput?: (input: { toolCallId: string; caller: ToolCaller; input: unknown; output: unknown }) => ToolResultValue;
  readonly userVisible?: boolean;
  readonly keepsTail?: true;
  readonly exposure?: 'deferred';
  readonly companions?: readonly string[];
  readonly vendor?: VendorWire;
  readonly subjects?: (input: never, caller: ToolCaller) => readonly PermissionSubject[];
  readonly prepare?: ToolPrepare;
  readonly claims?: ToolClaims;
  readonly refusals?: ToolRefusals;
  readonly settleEffect?: (input: ToolSettleCall<never>) => Effect.Effect<ToolEffectSettlement, ToolFailed>;
  readonly receipt?: (call: ToolPreparationCall) => ToolAnswer | undefined;
  readonly settled?: (call: ToolPreparationCall) => void;
  readonly doorFields?: readonly DoorField[];
  readonly contributor?: ToolContributor;
};

export type ToolContributor = {
  readonly id: string;
  standing(): boolean;
  readonly removed?: Effect.Effect<void>;
};

export const CONTRIBUTOR_ABSENT = 'contributor-absent';

export function contributorRefusal(id: string): ToolRefusal {
  return {
    code: CONTRIBUTOR_ABSENT,
    reason: `the source ${id} that offered this tool is no longer registered.`,
    words: 'Tool no longer offered',
  };
}

export function contributorAbsent(contributor: ToolContributor | undefined): PermissionOutcome | null {
  if (contributor === undefined || contributor.standing()) return null;
  return { verdict: 'deny', ...contributorRefusal(contributor.id) };
}

export type ToolDeclaration<TSchema extends ToolSchema, P = undefined> = {
  description: string;
  parameters: TSchema;
  inputRefusal?: InputRefusal;
  parseOptions?: SchemaAST.ParseOptions;
  inputSchema?: JsonSchema;
  execute?: (input: TSchema['Type'], call: ToolCallOptions<P>) => Effect.Effect<unknown, ToolFailed>;
  refusals?: ToolRefusals;
  display: ToolDisplayProjection<TSchema['Type']> | ((input: Partial<TSchema['Type']>) => ToolDisplay);
  recovery?: ToolRecovery<TSchema['Type']>;
  toModelOutput?: Tool['toModelOutput'];
  userVisible?: boolean;
  keepsTail?: true;
  exposure?: 'deferred';
  companions?: readonly string[];
  vendor?: VendorWire;
  settleEffect?: (input: ToolSettleCall<TSchema['Type']>) => Effect.Effect<ToolEffectSettlement, ToolFailed>;
  receipt?: (call: ToolPreparationCall) => ToolAnswer | undefined;
  settled?: (call: ToolPreparationCall) => void;
  ownWait?: true;
  document?: true;
  claims?: (input: TSchema['Type'], call: ToolPreparationCall) => Effect.Effect<readonly Claim[], ToolFailed>;
  approval: Approval;
  mutates?: boolean;
  confirmation?: {
    prompt(input: TSchema['Type'], prepared: NoInfer<P> | undefined): ToolConfirmation;
    prepare?(input: TSchema['Type']): Effect.Effect<ToolConfirmation, unknown>;
    confirmLabel: string;
    intent?: 'destructive';
  };
} & (
  | {
      prepare: (input: TSchema['Type'], call: ToolPreparationCall) => Effect.Effect<ToolPreparation<P>, ToolFailed>;
      subjects?: never;
    }
  | {
      prepare?: never;
      subjects?: (input: TSchema['Type'], caller: ToolCaller) => readonly PermissionSubject[];
    }
);

export function make<TSchema extends ToolSchema, P = undefined>(
  definition: ToolDeclaration<TSchema, P>,
): Tool & { readonly parameters: TSchema } {
  const { parameters, inputSchema, display, execute, prepare, claims, ownWait, document, ...rest } = definition;
  const refusals = definition.refusals ?? {};
  const checked = declaredFailure(refusals);
  const said = phrased(refusals);
  const declared = <A>(work: Effect.Effect<A, ToolFailed>): Effect.Effect<A, ToolFailed> => said(checked(work));
  const ownInputSchema = inputSchema ?? toolInputSchema(parameters);
  const fields: readonly DoorField[] =
    definition.vendor === undefined ? DOOR_FIELDS.filter((field) => (field === 'background' ? ownWait !== true : document === true)) : [];
  const offered = fields.length === 0 ? null : offeringDoorFields(ownInputSchema, fields);
  const resolvedInputSchema = offered ?? ownInputSchema;
  const projection =
    typeof display === 'function'
      ? {
          streamFields: isRecord(ownInputSchema) ? Object.keys(schemaProperties(ownInputSchema)) : null,
          project: display,
        }
      : display;
  return {
    ...rest,
    execute: execute === undefined ? undefined : (input: TSchema['Type'], call: ToolCallOptions<P>) => declared(execute(input, call)),
    prepare: prepare === undefined ? undefined : (input: TSchema['Type'], call: ToolPreparationCall) => declared(prepare(input, call)),
    claims: claims === undefined ? undefined : (input: TSchema['Type'], call: ToolPreparationCall) => declared(claims(input, call)),
    display: projection,
    doorFields: offered === null ? undefined : fields,
    parameters,
    inputSchema: resolvedInputSchema,
  } as Tool & { readonly parameters: TSchema };
}

function fieldSchemas(source: Tool): Readonly<Record<string, ToolSchema>> | null {
  const fields = (source.parameters as { fields?: Record<string, ToolSchema> } | undefined)?.fields;
  return fields === undefined || fields === null ? null : fields;
}

export function toolFieldNames(source: Tool): ReadonlySet<string> | null {
  const fields = fieldSchemas(source);
  return fields === null ? null : new Set(Object.keys(fields));
}

export function toolExecute(source: Tool): ToolDispatch | null {
  return typeof source.execute === 'function' ? (source.execute as ToolDispatch) : null;
}

export function toolDisplay(source: Tool, input: unknown): ToolDisplay | undefined {
  return source.display?.project(recordOrEmpty(input));
}

export function toolPartialDisplay(source: Tool, state: PartialJsonState): ToolDisplay | undefined {
  const projection = source.display;
  if (!projection) return undefined;
  const fields = projection.streamFields;
  if (!state.complete) {
    if (fields === null) return undefined;
    const completed = new Set(state.completedFields);
    if (!fields.some((field) => completed.has(field))) return undefined;
  }
  const display = projection.project(decodedFields(source, state.complete ? recordOrEmpty(state.value) : settledFields(state)));
  if (display.title === undefined || display.title.length === 0) return undefined;
  const head = {
    title: display.title,
    alone: display.alone,
    subtitle: display.subtitle,
    reference: display.reference,
    awaitsMs: display.awaitsMs,
  };
  const text: unknown = display.form === 'message' ? display.text : undefined;
  return typeof text === 'string' && text !== '' ? { ...head, form: 'message', text } : { ...head, form: 'none' };
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value) ? value : {};
}

function settledFields(state: PartialJsonState): Record<string, unknown> {
  const completed = new Set(state.completedFields);
  return Object.fromEntries(Object.entries(recordOrEmpty(state.value)).filter(([field]) => completed.has(field)));
}

function decodedFields(source: Tool, input: Record<string, unknown>): Record<string, unknown> {
  const schemas = fieldSchemas(source);
  if (schemas === null) return input;
  const decoded: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input)) {
    if (!Object.hasOwn(schemas, field)) continue;
    const read = Schema.decodeUnknownResult(jsonCodec(schemas[field]!))(value, source.parseOptions);
    if (Result.isSuccess(read)) decoded[field] = read.success;
  }
  return decoded;
}

export function toolSubjects(source: Tool, input: unknown, caller: ToolCaller): readonly PermissionSubject[] {
  return (source.subjects as ((input: unknown, caller: ToolCaller) => readonly PermissionSubject[]) | undefined)?.(input, caller) ?? [];
}

export function toolPrepare(source: Tool): ToolPrepareDispatch | null {
  return typeof source.prepare === 'function' ? (source.prepare as ToolPrepareDispatch) : null;
}

export function toolClaims(source: Tool, input: unknown, call: ToolPreparationCall): Effect.Effect<readonly Claim[], ToolFailed> {
  const declared = source.claims as
    | ((input: unknown, call: ToolPreparationCall) => Effect.Effect<readonly Claim[], ToolFailed>)
    | undefined;
  return declared === undefined ? Effect.succeed([]) : declared(input, call);
}

export function toolConfirmation(
  confirmation: ToolConfirmationDeclaration | undefined,
  input: unknown,
  prepared: unknown = undefined,
): ToolConfirmation | undefined {
  return (confirmation?.prompt as ((input: unknown, prepared: unknown) => ToolConfirmation) | undefined)?.(input, prepared);
}

export function reasonedConfirmation(
  asked: ToolConfirmation | undefined,
  reasons: readonly AskedReason[],
  toolName: string,
): ToolConfirmation {
  return {
    summary: asked?.summary ?? `Allow ${toolName}?`,
    facts: [...(asked?.facts ?? []), ...reasons.map((reason) => ({ label: 'Asks because', value: reason.text }))],
    consequence: asked?.consequence,
  };
}

export function toolPreparedConfirmation(
  confirmation: ToolConfirmationDeclaration | undefined,
  input: unknown,
): Effect.Effect<ToolConfirmation, unknown> | undefined {
  const prepare = confirmation?.prepare as ((input: unknown) => Effect.Effect<ToolConfirmation, unknown>) | undefined;
  return prepare?.(input);
}

export function toolSettleEffect(source: Tool, input: ToolSettleCall): Effect.Effect<ToolEffectSettlement, ToolFailed> | null {
  const settle = source.settleEffect as ((input: ToolSettleCall) => Effect.Effect<ToolEffectSettlement, ToolFailed>) | undefined;
  return settle ? settle(input) : null;
}

export const Tool = {
  ToolAnswer,
  ToolFailed,
  make,
  toolConfirmation,
  toolDisplay,
  toolExecute,
  toolFieldNames,
  toolPartialDisplay,
  toolPrepare,
  toolPreparedConfirmation,
  toolSettleEffect,
  toolSubjects,
} as const;

export namespace Tool {
  export type Tool = import('./tool').Tool;
  export type ToolAnswer = import('./tool').ToolAnswer;
  export type ToolCallDispatchOptions = import('./tool').ToolCallDispatchOptions;
  export type ToolCallOptions<P = undefined> = import('./tool').ToolCallOptions<P>;
  export type ToolDeclaration<TSchema extends ToolSchema, P = undefined> = import('./tool').ToolDeclaration<TSchema, P>;
  export type ToolDispatch = import('./tool').ToolDispatch;
  export type ToolFailed = import('./tool').ToolFailed;
  export type ToolMedia = import('./tool').ToolMedia;
  export type ToolReader = import('./tool').ToolReader;
  export type ToolSchema<A = unknown> = import('./tool').ToolSchema<A>;
}
