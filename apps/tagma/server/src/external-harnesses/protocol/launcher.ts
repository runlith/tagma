import { Effect, FileSystem } from 'effect';
import { threadCauseOf } from '@runlith/agent/thread/ThreadBorder';
import { describeError } from '@runlith/utils/error';
import type { HarnessAccounts } from '../../providers/contract/service/harness.js';
import type { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { Doctrine, doctrineOf } from '../../platform/contract/service/sections.js';
import { installForAccount } from '../installs/skillInstall.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import type { Settings } from '../../settings/contract/service/values.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessExecutionRef } from '../../threads/contract/wire/harness/observation.js';
import type { HarnessSession } from '../../threads/contract/wire/harness/session.js';
import { terminalRefusal } from '../../executions/terminals/refusal.js';
import type { HostManagement } from '../../executions/contract/service/host.js';
import type { TerminalRequests, Terminals } from '../../executions/contract/service/terminals.js';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { launchChoice, resolvedAsked } from '../birth/modelChoice.js';
import { harnessAdapter, servingProvider, transportOf } from '../contract/service/table.js';
import { accountFor, harnessPlace, type ProjectDeclaring } from '../sessions/launch.js';
import { harnessTitle } from '../settings.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { ProtocolEndings } from './endings.js';
import { launchAgent } from './link.js';
import type { SessionPlace } from './prompts.js';
import { freshRow, type ProtocolRow } from './row.js';

export type Launched = { readonly execution: HarnessExecutionRef; readonly fresh: boolean };

export class ProtocolLauncher {
  constructor(
    private readonly endings: ProtocolEndings,
    private readonly store: HarnessSessionStore,
    private readonly rows: ProtocolRows,
    private readonly terminals: Terminals['Service'],
    private readonly requests: TerminalRequests['Service'],
    private readonly host: HostManagement['Service'],
    private readonly settings: Settings['Service'],
    private readonly grants: GrantSigner['Service'],
    private readonly accounts: HarnessAccounts['Service'],
    private readonly providers: ProviderRegistry['Service'],
    private readonly place: SessionPlace,
    private readonly ownerId: string,
    private readonly cli: readonly string[],
    private readonly files: FileSystem.FileSystem,
    private readonly declaring: ProjectDeclaring,
  ) {}

  readonly launch = Effect.fnUntraced(function* (
    this: ProtocolLauncher,
    threadId: string,
    facet: ExternalSession,
    session: HarnessSession,
    stored: ProtocolRow | null,
  ) {
    const { endings, terminals, requests, store, ownerId } = this;
    const prepared = yield* Effect.result(this.prepare(threadId, facet, session, stored));
    if (prepared._tag === 'Failure') {
      const failure = prepared.failure;
      yield* endings.finish(threadId, session.id, 'failed', lineOf(failure), lasting(failure) ? 'lasting' : 'passing');
      return null;
    }
    if (prepared.success === null) return null;
    const { projectId, cwd, launches, account, where, argv } = prepared.success;
    const operation = HostRequestKey.make(`harness-run:${session.id}:${launches}`);
    const taken = yield* requests.request(projectId, operation).pipe(Effect.mapError(threadCallFailed));
    const attempt = yield* Effect.result(launchAgent(terminals, where, operation, argv));
    if (attempt._tag === 'Failure') {
      const standing = yield* requests.request(projectId, operation).pipe(Effect.mapError(threadCallFailed));
      if (!(standing._tag === 'Unknown' || (standing._tag === 'Settled' && standing.execution === undefined)))
        return yield* Effect.fail(attempt.failure);
      yield* endings.finish(threadId, session.id, 'failed', lineOf(attempt.failure));
      return null;
    }
    const started = attempt.success;
    if (started._tag === 'Refused') {
      yield* endings.finish(threadId, session.id, 'failed', lineOf(terminalRefusal(started.refusal)));
      return null;
    }
    if (started._tag !== 'Started') {
      return yield* new GateRefusal(
        'launch-uncertain',
        `The agent process start answered ${started._tag}; the same start is asked again under operation harness-run:${session.id}:${launches}.`,
        ['wait for the next recovery beat'],
      );
    }
    const execution: HarnessExecutionRef = {
      execution: started.record.execution.execution,
      incarnation: started.record.execution.incarnation,
    };
    const accepted = yield* store.owned(threadId, session.id, ownerId, (current, held) => ({
      ...current,
      execution,
      session: {
        ...held,
        cwd,
        account: account === null ? undefined : { provider: account.provider, key: account.account },
        state: held.state === 'stopping' ? 'stopping' : 'running',
      },
      observation: { ...current.observation, binding: { ...current.observation.binding, sessionId: held.id, execution } },
    }));
    const launched: Launched = { execution, fresh: taken._tag === 'Unknown' };
    return accepted === null ? null : launched;
  });

  private readonly prepare = Effect.fnUntraced(function* (
    this: ProtocolLauncher,
    threadId: string,
    facet: ExternalSession,
    session: HarnessSession,
    stored: ProtocolRow | null,
  ) {
    const { providers, store, rows, accounts, cli, files, terminals, host, settings, grants, ownerId, declaring } = this;
    const offer = yield* transportOf(facet.name, 'acp');
    const place = yield* this.place(threadId);
    const cwd = offer.profile.hosts === null ? (session.cwd ?? place.root) : place.root;
    const { models } = yield* providers.catalog;
    const choice = yield* launchChoice(
      models,
      facet.name,
      resolvedAsked(models, servingProvider(facet.name, 'acp'), yield* store.asked(threadId)),
      'acp',
    );
    const launches = Math.max(stored?.launches ?? 1, 1);
    if (launches !== stored?.launches) {
      yield* store.change(
        threadId,
        (current, unit) =>
          Effect.as(rows.write(unit, threadId, { ...(stored ?? freshRow(session.id, null, null)), launches }), {
            facet: current,
            value: undefined,
          }),
        rows.writes,
      );
    }
    const account = yield* accountFor(accounts, facet.name, place.selection, session.account, 'acp');
    if (account !== null && account.directory !== null && harnessAdapter(facet.name).hooks?.user != null)
      yield* installForAccount(facet.name, account.directory, doctrineOf(yield* Doctrine).contributed, cli).pipe(
        Effect.provideService(FileSystem.FileSystem, files),
        Effect.mapError(threadCallFailed),
      );
    yield* declaring(facet.name, place.projectId, place.root);
    const bound = yield* store.owned(threadId, session.id, ownerId, (current, held) => ({
      ...current,
      session: { ...held, account: account === null ? undefined : { provider: account.provider, key: account.account } },
    }));
    if (bound === null) return null;
    let where = yield* harnessPlace(
      terminals,
      host,
      settings,
      grants,
      threadId,
      place.projectId,
      facet.name,
      { id: session.id, cwd },
      offer,
      account,
    ).pipe(Effect.mapError(threadCallFailed));
    const profile = offer.profile;
    if (profile.storage !== undefined) {
      if (place.scratch === undefined) return yield* threadCallFailed(new Error('The hosted runner has no thread storage directory.'));
      where = {
        ...where,
        environment: {
          ...where.environment,
          entries: [
            ...where.environment.entries,
            { _tag: 'Set', name: profile.storage.environment, value: `${place.scratch}/${profile.storage.folder}` },
          ],
        },
      };
    }
    const titled =
      profile.untitled === undefined || (yield* settings.value(harnessTitle, place.projectId).pipe(Effect.mapError(threadCallFailed)));
    const [program, ...args] = [...profile.argv(choice), ...(titled ? [] : (profile.untitled ?? []))];
    const argv: readonly [string, ...string[]] = [program ?? harnessAdapter(facet.name).binary, ...args];
    return { projectId: place.projectId, cwd, launches, account, where, argv };
  });
}

const LASTING: ReadonlySet<string> = new Set([
  'account-required',
  'unknown-account',
  'login-unreadable',
  'account-cli-failed',
  'credential-reconnect',
  'credential-origin',
  'model-unavailable',
  'provider-not-installed',
  'provider-failed',
]);

const lasting = (failure: HarnessFailure): boolean => failure instanceof GateRefusal && LASTING.has(failure.code);

const lineOf = (failure: HarnessFailure): string =>
  failure instanceof GateRefusal
    ? `${failure.code}: ${failure.reason} — ${failure.unblock.join('; ')}`
    : `The agent process could not be started: ${describeError(threadCauseOf(failure))}`;
