import { Effect } from 'effect';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type {
  FileEffect,
  HarnessAdapter,
  HarnessCutAsk,
  HarnessCutMaking,
  HarnessLaunch,
  HarnessModelChoice,
  HarnessPrinted,
  HarnessReport,
} from './adapter.js';
import type { AcpProfile } from '../../protocol/profile.js';
import type { HarnessCall } from '../wire/call.js';
import { answerField } from '../../adapter/payload.js';
import { claudeCode } from '../../vendors/claude-code/row.js';
import { codex } from '../../vendors/codex/row.js';
import { cursor } from '../../vendors/cursor/row.js';
import { devin } from '../../vendors/devin/row.js';
import { gemini } from '../../vendors/gemini/row.js';
import { grok } from '../../vendors/grok/row.js';
import { opencode } from '../../vendors/opencode/row.js';
import type { HarnessName, HarnessTransport } from '../../../threads/contract/wire/harness/names.js';
import type { HarnessPresentation } from '../../../threads/contract/wire/harness/externalSession.js';

const ADAPTERS = { 'claude-code': claudeCode, codex, grok, devin, cursor, gemini, opencode } satisfies Record<HarnessName, HarnessAdapter>;

export const HARNESSES: readonly HarnessAdapter[] = Object.values(ADAPTERS);

const HOOK_DOOR_KEYS = ['agent_id', 'source'] as const;

export const HARNESS_HOOK_KEYS: readonly string[] = [...new Set([...HARNESSES.flatMap((row) => row.eventKeys), ...HOOK_DOOR_KEYS])];

export const HARNESS_ANSWER_KEYS: readonly string[] = [
  ...new Set(HARNESSES.flatMap((row) => (row.answerKey === null ? [] : [row.answerKey]))),
];

export function harnessAdapter<N extends HarnessName>(harness: N): (typeof ADAPTERS)[N] {
  return ADAPTERS[harness];
}

export const harnessPresentation = (name: HarnessName): HarnessPresentation => {
  const adapter = harnessAdapter(name);
  return {
    label: adapter.label,
    iconProvider: adapter.iconProvider ?? adapter.launch?.model?.provider ?? null,
    mark: adapter.mark ?? null,
    install: adapter.install ?? null,
    modelProvider: adapter.launch?.model?.provider ?? null,
    terminal: adapter.launch !== null,
    acp: adapter.acp !== undefined,
    hosted: adapter.acp?.hosts != null,
    sharedSessions: adapter.acp?.sharedSessions ?? true,
  };
};

export type TerminalOffer = { readonly transport: 'terminal'; readonly agent: null; readonly launch: HarnessLaunch };
export type AcpOffer = { readonly transport: 'acp'; readonly agent: string | null; readonly profile: AcpProfile };
export type HarnessTransportOffer = TerminalOffer | AcpOffer;

export function transportOf(name: HarnessName, asked: 'terminal'): Effect.Effect<TerminalOffer, GateRefusal>;
export function transportOf(name: HarnessName, asked: 'acp'): Effect.Effect<AcpOffer, GateRefusal>;
export function transportOf(name: HarnessName, asked?: HarnessTransport): Effect.Effect<HarnessTransportOffer, GateRefusal>;
export function transportOf(name: HarnessName, asked?: HarnessTransport): Effect.Effect<HarnessTransportOffer, GateRefusal> {
  const adapter = harnessAdapter(name);
  const transport = asked ?? (adapter.launch === null ? 'acp' : 'terminal');
  if (transport === 'terminal' && adapter.launch !== null) return Effect.succeed({ transport, agent: null, launch: adapter.launch });
  if (transport === 'acp' && adapter.acp !== undefined)
    return Effect.succeed({ transport, agent: adapter.acp.hosts, profile: adapter.acp });
  const available = adapter.launch === null ? 'acp' : 'terminal';
  return new GateRefusal('transport-unavailable', `${adapter.label} does not support ${transport}.`, [`use ${available}`]);
}

export const servingProvider = (name: HarnessName, transport: HarnessTransport): string | null => {
  const adapter = harnessAdapter(name);
  return transport === 'acp' ? (adapter.acp?.serves ?? null) : (adapter.launch?.model?.provider ?? null);
};

const permissionOf = (name: HarnessName, launch: HarnessLaunch, permissionMode: string | undefined) => {
  const modes = launch.permissionModes;
  if (permissionMode !== undefined && (modes === undefined || !modes.values.includes(permissionMode))) {
    return new GateRefusal('profile-permission', `${name} cannot launch in permission mode ${permissionMode}.`, [
      'choose a supported permission mode',
    ]);
  }
  return Effect.succeed(permissionMode === undefined ? undefined : modes!.argv(permissionMode));
};

export const harnessArgv = Effect.fnUntraced(function* (
  name: HarnessName,
  key: string | null,
  id: string,
  prompt: string,
  choice?: HarnessModelChoice,
  permissionMode?: string,
) {
  const { launch } = yield* transportOf(name, 'terminal');
  const text = prompt.trim() || undefined;
  const permission = yield* permissionOf(name, launch, permissionMode);
  return key !== null
    ? launch.resume(key, text, choice, permission)
    : (launch.assign?.(id, text, choice, permission) ?? launch.interactive(text, choice, permission));
});

export const cutArgv = Effect.fnUntraced(function* (
  name: HarnessName,
  making: Extract<HarnessCutMaking, { readonly _tag: 'Launch' }>,
  ask: HarnessCutAsk,
  into: string,
  prompt: string,
  choice?: HarnessModelChoice,
  permissionMode?: string,
) {
  const { launch } = yield* transportOf(name, 'terminal');
  const permission = yield* permissionOf(name, launch, permissionMode);
  return making.argv(ask, into, prompt.trim() || undefined, choice, permission);
});

export function harnessRoot(name: HarnessName, argv: readonly string[] | null): string | null {
  const adapter = harnessAdapter(name);
  return argv === null || argv[0] !== adapter.binary ? null : (adapter.launch?.root(argv) ?? null);
}

export const harnessOccasion = (
  name: HarnessName,
  event: { readonly name: string; readonly tool?: string; readonly notification?: string },
): ReturnType<HarnessAdapter['occasionOf']> => harnessAdapter(name).occasionOf(event);

export function harnessReport(adapter: HarnessAdapter, event: Record<string, unknown>): HarnessReport {
  return { sessionKey: adapter.sessionKeyOf(event), model: adapter.modelOf(event), turnId: adapter.turnOf(event) };
}

export const harnessAnswer = (adapter: HarnessAdapter, said: Record<string, unknown>): string | null =>
  answerField(said, adapter.answerKey);

export type HarnessAsking = { readonly adapter: HarnessAdapter; readonly call: HarnessCall };

export function harnessAsking(event: Record<string, unknown>, name: HarnessName | null = null): HarnessAsking | null {
  if (name !== null) {
    const adapter = harnessAdapter(name);
    const call = adapter.subjectOf(event);
    return call === null ? null : { adapter, call };
  }
  for (const adapter of HARNESSES) {
    const call = adapter.subjectOf(event);
    if (call !== null && Object.hasOwn(adapter.tools.byName, call.tool.toLowerCase())) return { adapter, call };
  }
  return null;
}

export function harnessPrinted(event: Record<string, unknown>): HarnessPrinted | null {
  for (const adapter of HARNESSES) {
    const printed = adapter.printedOf(event);
    if (printed !== null) return printed;
  }
  return null;
}

export function harnessFiles(event: Record<string, unknown>): readonly FileEffect[] {
  for (const adapter of HARNESSES) {
    const files = adapter.filesOf(event);
    if (files.length > 0) return files;
  }
  return [];
}
