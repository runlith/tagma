import { Effect } from 'effect';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { HarnessAdapter, HarnessReport } from './adapter.js';
import type { AcpProfile, HarnessCutAsk, HarnessCutMaking, HarnessLaunch, HarnessModelChoice } from '@runlith/tagma/adapter/harness';
import { answerField } from '../../adapter/payload.js';
import type { HarnessTransport } from '../../../threads/contract/wire/harness/names.js';
import type { HarnessPresentation } from '../../../threads/contract/wire/harness/externalSession.js';

export const harnessPresentation = (adapter: HarnessAdapter): HarnessPresentation => ({
  label: adapter.label,
  iconProvider: adapter.iconProvider ?? adapter.launch?.model?.provider ?? null,
  mark: adapter.mark ?? null,
  install: adapter.install ?? null,
  modelProvider: adapter.launch?.model?.provider ?? null,
  terminal: adapter.launch !== null,
  acp: adapter.acp !== undefined,
  hosted: adapter.acp?.hosts != null,
  sharedSessions: adapter.acp?.sharedSessions ?? true,
});

export type TerminalOffer = { readonly transport: 'terminal'; readonly agent: null; readonly launch: HarnessLaunch };
export type AcpOffer = { readonly transport: 'acp'; readonly agent: string | null; readonly profile: AcpProfile };
export type HarnessTransportOffer = TerminalOffer | AcpOffer;

export function transportOf(adapter: HarnessAdapter, asked: 'terminal'): Effect.Effect<TerminalOffer, GateRefusal>;
export function transportOf(adapter: HarnessAdapter, asked: 'acp'): Effect.Effect<AcpOffer, GateRefusal>;
export function transportOf(adapter: HarnessAdapter, asked?: HarnessTransport): Effect.Effect<HarnessTransportOffer, GateRefusal>;
export function transportOf(adapter: HarnessAdapter, asked?: HarnessTransport): Effect.Effect<HarnessTransportOffer, GateRefusal> {
  const transport = asked ?? (adapter.launch === null ? 'acp' : 'terminal');
  if (transport === 'terminal' && adapter.launch !== null) return Effect.succeed({ transport, agent: null, launch: adapter.launch });
  if (transport === 'acp' && adapter.acp !== undefined)
    return Effect.succeed({ transport, agent: adapter.acp.hosts, profile: adapter.acp });
  const available = adapter.launch === null ? 'acp' : 'terminal';
  return new GateRefusal('transport-unavailable', `${adapter.label} does not support ${transport}.`, [`use ${available}`]);
}

export const servingProvider = (adapter: HarnessAdapter, transport: HarnessTransport): string | null =>
  transport === 'acp' ? (adapter.acp?.serves ?? null) : (adapter.launch?.model?.provider ?? null);

const permissionOf = (adapter: HarnessAdapter, launch: HarnessLaunch, permissionMode: string | undefined) => {
  const modes = launch.permissionModes;
  if (permissionMode !== undefined && (modes === undefined || !modes.values.includes(permissionMode))) {
    return new GateRefusal('profile-permission', `${adapter.harness} cannot launch in permission mode ${permissionMode}.`, [
      'choose a supported permission mode',
    ]);
  }
  return Effect.succeed(permissionMode === undefined ? undefined : modes!.argv(permissionMode));
};

export const harnessArgv = Effect.fnUntraced(function* (
  adapter: HarnessAdapter,
  key: string | null,
  id: string,
  prompt: string,
  choice?: HarnessModelChoice,
  permissionMode?: string,
) {
  const { launch } = yield* transportOf(adapter, 'terminal');
  const text = prompt.trim() || undefined;
  const permission = yield* permissionOf(adapter, launch, permissionMode);
  return key !== null
    ? launch.resume(key, text, choice, permission)
    : (launch.assign?.(id, text, choice, permission) ?? launch.interactive(text, choice, permission));
});

export const cutArgv = Effect.fnUntraced(function* (
  adapter: HarnessAdapter,
  making: Extract<HarnessCutMaking, { readonly _tag: 'Launch' }>,
  ask: HarnessCutAsk,
  into: string,
  prompt: string,
  choice?: HarnessModelChoice,
  permissionMode?: string,
) {
  const { launch } = yield* transportOf(adapter, 'terminal');
  const permission = yield* permissionOf(adapter, launch, permissionMode);
  return making.argv(ask, into, prompt.trim() || undefined, choice, permission);
});

export function harnessRoot(adapter: HarnessAdapter, argv: readonly string[] | null): string | null {
  return argv === null || argv[0] !== adapter.binary ? null : (adapter.launch?.root(argv) ?? null);
}

export function harnessReport(adapter: HarnessAdapter, event: Record<string, unknown>): HarnessReport {
  return { sessionKey: adapter.sessionKeyOf(event), model: adapter.modelOf(event), turnId: adapter.turnOf(event) };
}

export const harnessAnswer = (adapter: HarnessAdapter, said: Record<string, unknown>): string | null =>
  answerField(said, adapter.answerKey);
