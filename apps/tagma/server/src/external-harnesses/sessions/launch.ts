import { Effect } from 'effect';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import type { HarnessAccounts, HarnessLaunch } from '../../providers/contract/service/harness.js';
import { HARNESS_HOOK_BYTES } from '../../threads/contract/wire/harness/observation.js';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { CommandEnvironmentRequest } from '@runlith/executions/CommandEnvironment';
import type { HarnessModelChoice } from '../contract/service/adapter.js';
import { harnessAdapter, harnessArgv, servingProvider, type HarnessTransportOffer } from '../contract/service/table.js';
import { sessionIdentity } from '../sessionPrefix.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessName, HarnessTransport } from '../../threads/contract/wire/harness/names.js';
import type { HarnessAskedModel } from '../../threads/contract/wire/harness/askedModel.js';
import { launchChoice } from '../birth/modelChoice.js';
import { HARNESS_STORAGE_VARIABLES, type HarnessSession, type HarnessStorage } from '../../threads/contract/wire/harness/session.js';
import { TerminalUnavailable } from '../../executions/contract/wire/refusals.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { nobodyEnvironment, sessionTokenEnvironment } from '../../platform/credentials/grants.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { homeVariable } from '../birth/profile.js';
import type { HarnessProfile } from '../settings.js';
import type { Settings } from '../../settings/contract/service/values.js';
import { terminalLastGrid } from '../../executions/contract/wire/terminalBehavior.js';
import { principalOf } from '../../executions/terminals/principals.js';
import { type TerminalActor } from '../../executions/contract/wire/terminals.js';
import type { ResolvedExecutionTarget, TargetKey } from '../../executions/contract/wire/targets.js';
import { targetIdentity, targetKeyOf } from '../../executions/terminals/subjectPolicy.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { HostManagement } from '../../executions/contract/service/host.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';

export const terminalArgv =
  (models: ModelCatalog, prompt: string) => (facet: ExternalSession, id: string, asked: HarnessAskedModel | undefined) =>
    Effect.flatMap(launchChoice(models, facet.name, asked), (choice) =>
      harnessArgv(facet.name, facet.sessionKey, id, prompt, choice, facet.permissionMode),
    );

export type AccountSelection = { readonly provider: string; readonly account: string | null };

export type ProjectDeclaring = (name: HarnessName, projectId: number, root: string) => Effect.Effect<void, HarnessFailure>;

export const accountFor = (
  accounts: HarnessAccounts['Service'],
  name: HarnessName,
  selection?: AccountSelection,
  held?: HarnessSession['account'],
  transport: HarnessTransport = 'terminal',
) => {
  const declared = servingProvider(name, transport);
  if (declared === null) return Effect.succeed(null);
  const provider = held?.provider ?? selection?.provider ?? declared;
  return Effect.map(accounts.launch(provider, held?.key ?? selection?.account ?? undefined), (launch) =>
    launch === null ? null : { ...launch, provider },
  );
};

export type HarnessPlace = {
  readonly actor: TerminalActor;
  readonly target: ResolvedExecutionTarget;
  readonly targetKey: TargetKey;
  readonly environment: CommandEnvironmentRequest;
  readonly grid: { readonly columns: number; readonly rows: number };
  readonly launchedFor: ThreadId;
};

export const harnessPlace = Effect.fnUntraced(function* (
  terminals: Terminals['Service'],
  host: HostManagement['Service'],
  settings: Settings['Service'],
  grants: GrantSigner['Service'],
  threadId: string,
  projectId: number,
  name: HarnessName,
  session: { readonly id: string; readonly cwd: string },
  offer: HarnessTransportOffer,
  account?: HarnessLaunch | null,
  profile: HarnessProfile = {},
) {
  const actor = { _tag: 'Operator' } as const;
  const principal = principalOf(actor);
  const target = yield* terminals.target({ projectId, kind: 'host', cwd: session.cwd });
  const measured = yield* settings.value(terminalLastGrid, projectId);
  const reserve = (yield* host.standing).geometry;
  const homeEnv = offer.transport === 'terminal' ? homeVariable(name) : null;
  if (profile.home !== undefined && homeEnv === null) {
    return yield* new GateRefusal('profile-unsupported', `${harnessAdapter(name).label} names no configuration folder to launch it with.`, [
      'start the thread in a project without threads.harnessProfile.home for this CLI',
    ]);
  }
  const identity =
    profile.plain === true ? nobodyEnvironment(sessionIdentity) : sessionTokenEnvironment(grants, threadId, session.id, sessionIdentity);
  return {
    actor,
    target,
    grid:
      measured === null ? reserve : { columns: Math.min(measured.columns, reserve.columns), rows: Math.min(measured.rows, reserve.rows) },
    targetKey: targetKeyOf(targetIdentity(target, principal, principal)),
    launchedFor: ThreadId.make(threadId),
    environment: {
      inherit: true,
      entries: [
        ...Object.entries(identity).map(([variable, value]) =>
          value === undefined ? { _tag: 'Unset' as const, name: variable } : { _tag: 'Set' as const, name: variable, value },
        ),
        ...Object.entries(harnessAdapter(name).env ?? {}).map(([variable, value]) => ({ _tag: 'Set' as const, name: variable, value })),
        ...(profile.home === undefined || homeEnv === null ? [] : [{ _tag: 'Set' as const, name: homeEnv, value: profile.home }]),
        ...(account?.entries ?? []),
      ],
    },
  } satisfies HarnessPlace;
});

export const harnessRunKey = (sessionId: string): HostRequestKey => HostRequestKey.make(`harness-run:${sessionId}`);

export const launchHarness = Effect.fnUntraced(function* <E>(
  terminals: Terminals['Service'],
  place: HarnessPlace,
  facet: ExternalSession,
  session: HarnessSession & { readonly cwd: string },
  choice: HarnessModelChoice | undefined,
  recordStorage: (storage: HarnessStorage) => Effect.Effect<void, E>,
) {
  const adapter = harnessAdapter(facet.name);
  const argv = session.argv ?? (yield* harnessArgv(facet.name, facet.sessionKey, session.id, session.prompt, choice, facet.permissionMode));
  return yield* terminals.start({
    actor: place.actor,
    operationId: harnessRunKey(session.id),
    target: place.target,
    targetKey: place.targetKey,
    program: argv[0] ?? adapter.binary,
    args: argv.slice(1),
    transport: 'pty',
    lifetime: 'held',
    geometry: place.grid,
    purpose: 'command',
    launchedFor: place.launchedFor,
    prepared: (launch) => {
      const environment = new Map(launch.command.environment.map((entry) => [entry.name, entry.value]));
      const storage: HarnessStorage = {
        binding: place.target.binding,
        entries: HARNESS_STORAGE_VARIABLES.flatMap((name) => {
          const value = environment.get(name);
          return value === undefined ? [] : [{ name, value }];
        }),
      };
      const bounded =
        Buffer.byteLength(JSON.stringify(storage.entries)) <= HARNESS_HOOK_BYTES
          ? storage
          : { binding: storage.binding, entries: [], unreadable: 'launch-storage-limit' as const };
      return recordStorage(bounded).pipe(
        Effect.mapError(
          () =>
            new TerminalUnavailable({
              owner: 'store',
              message: 'The launch storage binding could not be recorded; this launch was not dispatched.',
            }),
        ),
      );
    },
    environment: place.environment,
  });
}, Effect.scoped);
