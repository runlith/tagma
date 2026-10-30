import type { Effect, FileSystem, PlatformError } from 'effect';
import type { Approval, PermissionKind } from '@runlith/agent/permissions';
import type { TransportFailure } from '@runlith/agent/transcript/entries';
import type { HarnessModelReport } from '../../../threads/contract/wire/harness/observation.js';
import type { HarnessQuestionKind, HarnessQuestionOption } from '../../../threads/contract/wire/harness/session.js';
import type { HarnessCall } from '../wire/call.js';
import type { HarnessName } from '../../../threads/contract/wire/harness/names.js';
import type { McpToolShape } from '../../../platform/contract/wire/session.js';
import type { AcpProfile } from '../../protocol/profile.js';

export const HOOK_FORMATS = ['claude-code', 'cursor', 'codex', 'gemini', 'devin'] as const;
export type HookFormat = (typeof HOOK_FORMATS)[number];

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
  readonly format: HookFormat;
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

export type HarnessReport = {
  readonly sessionKey: string | null;
  readonly model: HarnessModelReport | null;
  readonly turnId: string | null;
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

export type HarnessTool = { readonly kind: PermissionKind; readonly approval: Approval };

export type HarnessTools = {
  readonly names: 'vendor' | 'kind';
  readonly byName: Readonly<Record<string, HarnessTool>>;
};

export type HarnessAdapter = {
  readonly harness: HarnessName;
  readonly label: string;
  readonly iconProvider?: string;
  readonly mark?: string;
  readonly prefix: string;
  readonly variable?: string;
  readonly exports?: readonly string[];
  readonly binary: string;
  readonly installedIn?: (home: string) => readonly string[];
  readonly install?: string;
  readonly metadata?: 'claude-jsonl' | 'codex-rollout' | 'grok-summary' | 'devin-atif' | 'cursor-terminal';
  readonly tools: HarnessTools;
  readonly env?: Record<string, string>;
  readonly hooks: HookSurface | null;
  readonly setup?: HarnessSetup;
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
} & ({ readonly launch: HarnessLaunch; readonly acp?: AcpProfile } | { readonly launch: null; readonly acp: AcpProfile });

export type TerminalHarnessAdapter = HarnessAdapter & { readonly launch: HarnessLaunch };
