import { Schema, type Effect, type FileSystem, type PlatformError } from 'effect';
import type { Approval, PermissionKind } from '@runlith/agent/permissions';
import type { TransportFailure } from '@runlith/agent/transcript/entries';
import type { TransportCapabilities, TransportWeb } from '@runlith/agent/thread/record';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { HookCodec } from './hook';
import type { MetadataReader } from './metadata';

export const HARNESS_ID_MAX = 200;
export const HARNESS_DETAIL_MAX = 160;

export const harnessNameSchema = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u), Schema.isMaxLength(64));
export const RESERVED_HARNESS_NAMES: readonly string[] = ['tagma', 'lode'];
export const HOST_COMMAND = 'tagma';

export const harnessClaimSchema = Schema.Literals(['configured', 'serving', 'last-recorded']);
export type HarnessClaim = typeof harnessClaimSchema.Type;

export const harnessProvenanceSchema = Schema.Literals(['hook', 'vendor-record', 'transcript', 'session-store', 'terminal', 'protocol']);
export type HarnessProvenance = typeof harnessProvenanceSchema.Type;

export const harnessModelReportSchema = Schema.Union([
  Schema.Struct({
    read: Schema.Literal('value'),
    value: Schema.String.check(Schema.isMaxLength(HARNESS_ID_MAX)),
    claim: harnessClaimSchema,
  }),
  Schema.Struct({ read: Schema.Literal('absent') }),
  Schema.Struct({ read: Schema.Literal('unsupported') }),
  Schema.Struct({
    read: Schema.Literal('unreadable'),
    reason: Schema.String.check(Schema.isMaxLength(HARNESS_DETAIL_MAX)),
  }),
]);
export type HarnessModelReport = typeof harnessModelReportSchema.Type;

export const harnessQuestionOptionSchema = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
});
export type HarnessQuestionOption = typeof harnessQuestionOptionSchema.Type;

export const harnessQuestionKindSchema = Schema.Literals(['choice']);
export type HarnessQuestionKind = typeof harnessQuestionKindSchema.Type;

export const harnessCallSchema = Schema.Struct({
  id: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  tool: Schema.String.check(Schema.isMinLength(1)),
  subject: Schema.String.check(Schema.isMinLength(1)),
});
export type HarnessCall = typeof harnessCallSchema.Type;

export const MCP_TOOL_SHAPES = ['catalog', 'proxy'] as const;
export type McpToolShape = (typeof MCP_TOOL_SHAPES)[number];

export type HookEvents = {
  readonly sessionStart: string | null;
  readonly preWrite: string | null;
  readonly postWrite: string | null;
  readonly postRead: string | null;
  readonly stop: string | null;
  readonly permission: string | null;
  readonly agentResponse?: string;
  readonly prompt?: string;
  readonly sessionEnd?: string;
  readonly toolFailure?: string;
  readonly stopFailure?: string;
  readonly notification?: string;
};

export type HookUserFile = { readonly folder: readonly string[]; readonly file: string; readonly homeEnv?: string };

export type HookAsset = { readonly file: string; readonly content: string };

export type HookContextLimit = { readonly chars: number; readonly basis: 'measured' | 'reported' | 'unmeasured' };

export const HOOK_CONTEXT_CHARS = 10_000;

export const UNMEASURED_HOOK_CONTEXT: HookContextLimit = { chars: HOOK_CONTEXT_CHARS, basis: 'unmeasured' };

export type HookSurface = {
  readonly file: string;
  readonly assets?: readonly HookAsset[];
  readonly codec: HookCodec;
  readonly events: HookEvents;
  readonly user: HookUserFile | null;
  readonly context: HookContextLimit;
  readonly promptContext?: boolean;
};

export type McpConfigFile =
  | { readonly _tag: 'Project'; readonly path: string }
  | {
      readonly _tag: 'Home';
      readonly folder: readonly string[];
      readonly file: string;
      readonly homeEnv?: string;
    };

export type McpSurface = {
  readonly file: McpConfigFile;
  readonly format: 'json' | 'toml';
  readonly servers: string | readonly string[];
  readonly environment?: string;
  readonly declaration?: (cli: readonly string[], environment: Readonly<Record<string, string>>) => Readonly<Record<string, unknown>>;
  readonly fields?: Readonly<Record<string, string | boolean | number>>;
  readonly approve?: (name: string) => readonly string[];
};

export type HarnessPrinted =
  | { readonly _tag: 'Shell'; readonly command: string; readonly output: string }
  | { readonly _tag: 'Search'; readonly found: readonly string[]; readonly output: string };

export type FileEffect =
  | { readonly effect: 'read'; readonly path: string }
  | { readonly effect: 'write'; readonly path: string }
  | { readonly effect: 'delete'; readonly path: string }
  | { readonly effect: 'move'; readonly path: string; readonly from: string };

export type HookOccasion = (event: {
  readonly name: string;
  readonly tool?: string;
  readonly notification?: string;
}) => 'session-start' | 'turn-start' | 'activity' | 'wait' | 'turn-end' | 'self-description';

export type RpcRequest = {
  readonly method: string;
  readonly params: unknown;
};

export type PrepareAnswer =
  | { readonly _tag: 'Answered'; readonly value: unknown }
  | { readonly _tag: 'VendorError'; readonly code: number; readonly message: string };

export type PrepareJudgment<T> = { readonly _tag: 'Accept'; readonly value: T } | { readonly _tag: 'Refuse'; readonly reason: string };

export type PreparedRoot = { readonly id: string; readonly artifact: string };

export type HarnessPrepare = {
  readonly server: (cwd: string) => { readonly program: string; readonly args: ReadonlyArray<string> };
  readonly initialize: {
    readonly request: (client: { readonly name: string; readonly version: string }) => RpcRequest;
    readonly judge: (outcome: PrepareAnswer) => PrepareJudgment<void>;
  };
  readonly start: {
    readonly request: (workspace: string) => RpcRequest;
    readonly judge: (outcome: PrepareAnswer) => PrepareJudgment<PreparedRoot>;
  };
  readonly read: {
    readonly request: (threadId: string) => RpcRequest;
    readonly judge: (outcome: PrepareAnswer) => PrepareJudgment<void>;
  };
};

export const ADOPTED_HARNESS_PERMISSION_STANCE = 'tagma' as const;
export type HarnessCutAsk = { readonly root: string; readonly address: string | null };

export type HarnessCutRows = 'copied' | 'unaddressed';

export type HarnessCutTurns = {
  readonly request: (root: string) => RpcRequest;
  readonly judge: (outcome: PrepareAnswer) => PrepareJudgment<readonly (string | null)[]>;
};

export type HarnessCutMaking =
  | {
      readonly _tag: 'Launch';
      readonly argv: (
        ask: HarnessCutAsk,
        into: string,
        prompt?: string,
        choice?: HarnessModelChoice,
        permission?: readonly string[],
      ) => string[];
      readonly rows: HarnessCutRows;
    }
  | {
      readonly _tag: 'Prepare';
      readonly server: (cwd: string) => { readonly program: string; readonly args: ReadonlyArray<string> };
      readonly initialize: HarnessPrepare['initialize'];
      readonly fork: {
        readonly request: (ask: HarnessCutAsk, workspace: string) => RpcRequest;
        readonly judge: (outcome: PrepareAnswer) => PrepareJudgment<PreparedRoot>;
      };
      readonly rows: HarnessCutRows | HarnessCutTurns;
    };

export type HarnessCut = { readonly whole: HarnessCutMaking | null; readonly point: HarnessCutMaking | null };

export type HarnessCarry = {
  readonly folder: string;
  readonly session: (
    files: FileSystem.FileSystem,
    home: string,
    root: string,
  ) => Effect.Effect<readonly string[], PlatformError.PlatformError>;
};

export type HarnessRunSeen = { readonly turn: string | null; readonly before: string | null };

export type HarnessAddress = { readonly reads: 'turn' | 'transcript'; readonly of: (seen: HarnessRunSeen) => string | null };

export type HarnessPermissionStance = typeof ADOPTED_HARNESS_PERMISSION_STANCE;
export type HarnessPermissionArgv = Readonly<Record<HarnessPermissionStance, readonly string[] | null>>;

export function adoptedPermissionArgv(declaration: HarnessPermissionArgv): readonly string[] {
  const argv = declaration[ADOPTED_HARNESS_PERMISSION_STANCE];
  if (argv === null) throw new Error(`The harness cannot express permission stance ${ADOPTED_HARNESS_PERMISSION_STANCE}.`);
  return argv;
}

export type HarnessPermissionModes = {
  readonly values: readonly string[];
  readonly argv: (mode: string) => readonly string[];
};

export type HarnessModelChoice = { readonly model: string; readonly rung: string | null };

export type HarnessModelArgv = {
  readonly provider: string;
  readonly argv: (choice: HarnessModelChoice) => readonly string[];
} | null;

export function chosenModelArgv(declaration: HarnessModelArgv, choice: HarnessModelChoice | undefined): readonly string[] {
  if (choice === undefined) return [];
  const asked = choice.rung === null ? choice.model : `${choice.model} at ${choice.rung}`;
  if (declaration === null) throw new Error(`The harness declares no model surface and cannot launch on ${asked}.`);
  return declaration.argv(choice);
}

export type HarnessLaunch = {
  readonly permission: HarnessPermissionArgv;
  readonly permissionModes?: HarnessPermissionModes;
  readonly model: HarnessModelArgv;
  readonly interactive: (prompt?: string, choice?: HarnessModelChoice, permission?: readonly string[]) => string[];
  readonly resume: (key: string, prompt?: string, choice?: HarnessModelChoice, permission?: readonly string[]) => string[];
  readonly assign?: (key: string, prompt?: string, choice?: HarnessModelChoice, permission?: readonly string[]) => string[];
  readonly root: (argv: readonly string[]) => string | null;
  readonly export?: (argv: readonly string[], path: string) => string[];
  readonly witness?: (text: string) => string | null;
  readonly prepare?: HarnessPrepare;
  readonly cut?: HarnessCut;
  readonly carry?: HarnessCarry;
  readonly address?: HarnessAddress;
};

export type ScreenAskPicks = { readonly checked: readonly string[] };

export type ScreenAskTyped = { readonly value: string; readonly draft: string };

export type ScreenAsk = {
  readonly kind: HarnessQuestionKind;
  readonly prompt: string;
  readonly header: string | null;
  readonly subject: string | null;
  readonly options: readonly HarnessQuestionOption[];
  readonly selected: string | null;
  readonly freeform?: ScreenAskTyped;
  readonly picks?: ScreenAskPicks;
};

export type HarnessWidgetKey =
  | 'up'
  | 'down'
  | 'enter'
  | 'esc'
  | { readonly _tag: 'char'; readonly char: string }
  | { readonly _tag: 'text'; readonly text: string };

export type HarnessScreenReader = (lines: readonly string[]) => ScreenAsk | null;

export type HarnessQuit = readonly (readonly HarnessWidgetKey[])[];

export const INTERRUPT_KEY: HarnessWidgetKey = { _tag: 'char', char: '\u0003' };

export const unmeasuredScreen: HarnessScreenReader = () => null;

export const unmeasuredKeys = (): null => null;

export const oneValue =
  (keys: (ask: ScreenAsk, value: string) => readonly HarnessWidgetKey[] | null) =>
  (ask: ScreenAsk, values: readonly string[]): readonly HarnessWidgetKey[] | null =>
    values.length === 1 ? keys(ask, values[0]!) : null;

export const navigateChoice = (ask: ScreenAsk, value: string): readonly HarnessWidgetKey[] | null => {
  if (ask.selected === null) return null;
  const from = ask.options.findIndex((option) => option.value === ask.selected);
  const to = ask.options.findIndex((option) => option.value === value);
  if (from < 0 || to < 0) return null;
  const step = to > from ? 'down' : 'up';
  return [...Array.from<HarnessWidgetKey>({ length: Math.abs(to - from) }).fill(step), 'enter'];
};

export const typeChoice = (ask: ScreenAsk, value: string): readonly HarnessWidgetKey[] | null =>
  ask.options.some((option) => option.value === value) ? [...value].map((char) => ({ _tag: 'char', char })) : null;

export type ScreenChoice = { readonly value: string; readonly label: string; readonly selected: boolean };

export type ScreenChoices = {
  readonly options: readonly HarnessQuestionOption[];
  readonly selected: string | null;
  readonly marked: number;
  readonly above: number;
};

export const screenChoices = (
  lines: readonly string[],
  match: (line: string) => ScreenChoice | null,
  end: number = lines.findLastIndex((line) => match(line) !== null),
): ScreenChoices | null => {
  if (end < 0) return null;
  const options: HarnessQuestionOption[] = [];
  const marked: string[] = [];
  let above = end;
  for (; above >= 0; above -= 1) {
    const drawn = match(lines[above]!);
    if (drawn === null) break;
    options.push({ value: drawn.value, label: drawn.label });
    if (drawn.selected) marked.push(drawn.value);
  }
  options.reverse();
  return { options, selected: marked.length === 1 ? marked[0]! : null, marked: marked.length, above };
};

export type HarnessReturned = { readonly clear: readonly HarnessWidgetKey[]; readonly counts: 'breaks' | 'lines' };

export type HarnessComposer = {
  readonly of: (lines: readonly string[]) => string | null;
  readonly returns?: HarnessReturned;
  readonly drafted?: readonly HarnessWidgetKey[];
};

export type HarnessExitArm = {
  readonly key: HarnessWidgetKey;
  readonly windowMs: number;
  readonly banner: string;
  readonly version: string;
};

export type HarnessEnds = {
  readonly interrupt: 'screen' | 'record';
  readonly idle: 'notification' | null;
  readonly tail: 'final' | 'prompt';
};

export type HarnessSetup = { readonly file: string; readonly done: string };

export type InstructionSurface = {
  readonly file: string;
  readonly imports?: (text: string) => boolean;
};

export type SkillSurface = { readonly project?: string; readonly user: HookUserFile };

export type HarnessTool = { readonly kind: PermissionKind; readonly approval: Approval };

export type HarnessTools = {
  readonly names: 'vendor' | 'kind';
  readonly byName: Readonly<Record<string, HarnessTool>>;
};

export const ASKS_NEVER: Approval = { asksFrom: 'never' };
export const ASKS_IN_REVIEW: Approval = { asksFrom: 'review', timeout: 'none' };

export const LEGACY_TOOLS: HarnessTools = {
  names: 'kind',
  byName: {
    bash: { kind: 'execute', approval: ASKS_IN_REVIEW },
    read: { kind: 'read', approval: ASKS_NEVER },
    ls: { kind: 'read', approval: ASKS_NEVER },
    glob: { kind: 'read', approval: ASKS_NEVER },
    grep: { kind: 'read', approval: ASKS_NEVER },
    write: { kind: 'write', approval: ASKS_IN_REVIEW },
    edit: { kind: 'write', approval: ASKS_IN_REVIEW },
    delete: { kind: 'write', approval: ASKS_IN_REVIEW },
    rename: { kind: 'write', approval: ASKS_IN_REVIEW },
    webfetch: { kind: 'network', approval: ASKS_IN_REVIEW },
    websearch: { kind: 'network', approval: ASKS_IN_REVIEW },
  },
};

export type TerminalSurface = {
  readonly prefix: string;
  readonly variable?: string;
  readonly exports?: readonly string[];
  readonly binary: string;
  readonly installedIn?: (home: string) => readonly string[];
  readonly install?: string;
  readonly metadata?: MetadataReader;
  readonly tools: HarnessTools;
  readonly env?: Record<string, string>;
  readonly hooks: HookSurface | null;
  readonly setup?: HarnessSetup;
  readonly instructions?: InstructionSurface;
  readonly skill?: SkillSurface;
  readonly mcpTools: McpToolShape;
  readonly mcpCallMeta?: string;
  readonly mcp: McpSurface | null;
  readonly occasionOf: HookOccasion;
  readonly sessionKeyOf: (event: Record<string, unknown>) => string | null;
  readonly modelOf: (event: Record<string, unknown>) => HarnessModelReport | null;
  readonly reportsModel: boolean;
  readonly turnOf: (event: Record<string, unknown>) => string | null;
  readonly answerKey: string | null;
  readonly promptKey?: string;
  readonly subjectOf: (event: Record<string, unknown>) => HarnessCall | null;
  readonly filesOf: (event: Record<string, unknown>) => readonly FileEffect[];
  readonly printedOf: (event: Record<string, unknown>) => HarnessPrinted | null;
  readonly failureOf?: (event: Record<string, unknown>) => TransportFailure | null;
  readonly eventKeys: readonly string[];
  readonly screenAskOf: HarnessScreenReader;
  readonly promptScreenOf?: (lines: readonly string[]) => boolean;
  readonly composer?: HarnessComposer;
  readonly keysOf: (ask: ScreenAsk, values: readonly string[]) => readonly HarnessWidgetKey[] | null;
  readonly cancelKeysOf: (ask: ScreenAsk) => readonly HarnessWidgetKey[] | null;
  readonly interrupt: readonly HarnessWidgetKey[] | null;
  readonly exitArm?: HarnessExitArm;
  readonly steer: 'step' | 'none';
  readonly quit: HarnessQuit | null;
  readonly callEnvelopeMs: number | null;
  readonly ends: HarnessEnds;
  readonly launch: HarnessLaunch;
};

export type ConfigChoice = { readonly configId: string; readonly value: string };

export type AcpProves = {
  readonly law: NonNullable<TransportCapabilities['law']>;
  readonly touch: NonNullable<TransportCapabilities['touch']>;
  readonly authorship: NonNullable<TransportCapabilities['authorship']>;
  readonly fork: boolean;
  readonly rewind: boolean;
  readonly compaction: boolean | 'foreign' | 'vendor';
  readonly continue: boolean;
  readonly usage: TransportCapabilities['usage'];
  readonly aside: Exclude<TransportCapabilities['aside'], 'request'>;
};

export type AcpProfile = {
  readonly argv: (choice: HarnessModelChoice | undefined) => readonly string[];
  readonly untitled?: readonly string[];
  readonly configure: (choice: HarnessModelChoice | undefined, switches: ModelSwitches) => readonly ConfigChoice[];
  readonly reportedModel: string | null;
  readonly hosts: string | null;
  readonly serves: string | null;
  readonly program?: string;
  readonly web: TransportWeb;
  readonly mode: string;
  readonly proves: AcpProves;
  readonly toolCatalog?: TransportCapabilities['toolCatalog'];
  readonly storage?: { readonly environment: string; readonly folder: string };
  readonly graceMs: number;
  readonly callEnvelopeMs: number | null;
  readonly handshakeMs: number;
  readonly login: { readonly command: string; readonly codes: readonly number[] };
  readonly lockedCode: number | null;
  readonly otherMutates: boolean;
  readonly midTurn: 'after-turn' | 'steer';
  readonly sharedSessions: boolean;
  readonly extensions: readonly string[];
};

export type HarnessSurfaces = {
  readonly harnessLabel?: string;
  readonly mark?: string;
  readonly terminal?: TerminalSurface;
  readonly acp?: AcpProfile;
};
