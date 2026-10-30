import { Cause, Effect, Exit, FileSystem, Result } from 'effect';
import type { HarnessAccounts } from '../../providers/contract/service/harness.js';
import type { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { Doctrine, doctrineOf } from '../../platform/contract/service/sections.js';
import { installForAccount } from '../installs/skillInstall.js';
import type { Settings } from '../../settings/contract/service/values.js';
import type { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { transportOf } from '../contract/service/table.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { HarnessAdapters } from '../contract/service/adapters.js';
import type { AdapterInstalls } from '../../providers/contract/service/adapters.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { launchChoice } from '../birth/modelChoice.js';
import type { HarnessProcessOutcome, HarnessSession } from '../../threads/contract/wire/harness/session.js';
import type { TerminalRequests, Terminals } from '../../executions/contract/service/terminals.js';
import type { HostManagement } from '../../executions/contract/service/host.js';
import type { SessionRoots } from './roots.js';
import type { SessionAlignment } from './alignment.js';
import type { ScratchAreas } from '../../threads/contract/service/scratch.js';
import { HarnessSessionStore } from '../store/sessions.js';
import { refusalLine } from '../../threads/contract/wire/harness/failureLine.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { SessionPlace } from '../protocol/prompts.js';
import type { HarnessModelChoice } from '@runlith/tagma/adapter/harness';
import { accountFor, harnessPlace, harnessRunKey, launchHarness, type HarnessPlace, type ProjectDeclaring } from './launch.js';
import { sessionIdentityOf } from '../sessionPrefix.js';
import { recordStorageGate, provisionReason } from './lifecycle.js';

type Finish = (
  threadId: string,
  sessionId: string,
  outcome: HarnessProcessOutcome,
  failure: string | null,
) => Effect.Effect<void, HarnessFailure>;

type Unsent = (threadId: string, sessionId: string, cause: Cause.Cause<unknown>, reason?: string) => Effect.Effect<void, HarnessFailure>;

type Ready = {
  readonly adapter: HarnessAdapter;
  readonly where: HarnessPlace;
  readonly prepared: ExternalSession;
  readonly choice: HarnessModelChoice | undefined;
};

export class SessionLauncher {
  constructor(
    private readonly store: HarnessSessionStore,
    private readonly terminals: Terminals['Service'],
    private readonly requests: TerminalRequests['Service'],
    private readonly host: HostManagement['Service'],
    private readonly settings: Settings['Service'],
    private readonly grants: GrantSigner['Service'],
    private readonly accounts: HarnessAccounts['Service'],
    private readonly providers: ProviderRegistry['Service'],
    private readonly scratch: ScratchAreas['Service'],
    private readonly roots: SessionRoots,
    private readonly alignment: SessionAlignment,
    private readonly place: SessionPlace,
    private readonly ownerId: string,
    private readonly cli: readonly string[],
    private readonly finish: Finish,
    private readonly uncertain: (threadId: string, sessionId: string, failure: string) => Effect.Effect<void>,
    private readonly unsent: Unsent,
    private readonly files: FileSystem.FileSystem,
    private readonly declaring: ProjectDeclaring,
    private readonly adapters: HarnessAdapters['Service'],
    private readonly installs: AdapterInstalls['Service'],
  ) {}

  readonly launch = Effect.fnUntraced(function* (
    this: SessionLauncher,
    threadId: string,
    facet: ExternalSession,
    session: HarnessSession,
    launching: boolean,
    declaresExport: boolean,
  ) {
    const readied = yield* Effect.exit(Effect.scoped(this.prepare(threadId, facet, session, launching, declaresExport)));
    if (Exit.isFailure(readied)) {
      if (Cause.hasInterruptsOnly(readied.cause)) return yield* Effect.failCause(readied.cause);
      yield* this.unsent(threadId, session.id, readied.cause);
      return null;
    }
    return readied.value === null ? null : yield* this.dispatch(threadId, session, readied.value);
  });

  private readonly prepare = Effect.fnUntraced(function* (
    this: SessionLauncher,
    threadId: string,
    facet: ExternalSession,
    session: HarnessSession,
    launching: boolean,
    declaresExport: boolean,
  ) {
    const { store, terminals, host, settings, grants, accounts, providers, scratch, roots, ownerId, cli, finish, files, declaring } = this;
    let adapter = yield* this.adapters.row(facet.name, facet.presentation.install);
    while (!(yield* this.installs.hold(adapter.package ?? null, true)))
      adapter = yield* this.adapters.row(facet.name, facet.presentation.install);
    const offer = yield* transportOf(adapter, 'terminal');
    const { launch } = offer;
    const place = yield* this.place(threadId);
    if (launching && declaresExport && session.exportPath === undefined) {
      const owned = scratch.directory(threadId);
      if (place.scratch !== owned) {
        yield* finish(
          threadId,
          session.id,
          'failed',
          `export-unavailable: the launch world names ${place.scratch ?? 'no scratch directory'}, which is not this thread's scratch directory.`,
        );
        return null;
      }
      const provisioned = yield* Effect.exit(scratch.ensure(threadId));
      if (!Exit.isSuccess(provisioned)) {
        yield* this.unsent(threadId, session.id, provisioned.cause, provisionReason(owned, provisioned.cause));
        return null;
      }
    }
    const cwd = session.cwd ?? place.root;
    const { models } = yield* providers.catalog;
    const chosen = yield* Effect.result(launchChoice(models, adapter, yield* store.asked(threadId)));
    if (Result.isFailure(chosen)) {
      yield* finish(threadId, session.id, 'failed', `${chosen.failure.code}: ${chosen.failure.reason}`);
      return null;
    }
    const choice = chosen.success;
    const selected = yield* (
      facet.home === undefined && facet.plain !== true
        ? accountFor(accounts, adapter, place.selection, session.account)
        : Effect.succeed(null)
    ).pipe(
      Effect.map((account) => ({ _tag: 'Ready' as const, account })),
      Effect.catchTag('GateRefusal', (refusal) =>
        Effect.as(finish(threadId, session.id, 'failed', `${refusal.message} — ${refusal.unblock.join('; ')}`), {
          _tag: 'Ended' as const,
        }),
      ),
      Effect.mapError(threadCallFailed),
    );
    if (selected._tag === 'Ended') return null;
    const { account } = selected;
    const into =
      facet.plain === true ? undefined : facet.home !== undefined ? facet.home : account === null ? undefined : account.directory;
    if (into !== undefined)
      yield* installForAccount(facet.name, into, doctrineOf(yield* Doctrine).contributed, cli).pipe(
        Effect.provideService(FileSystem.FileSystem, files),
        Effect.provideService(HarnessAdapters, this.adapters),
        Effect.mapError(threadCallFailed),
      );
    if (facet.plain !== true) yield* declaring(facet.name, place.projectId, place.root);
    const where = yield* harnessPlace(
      terminals,
      host,
      settings,
      grants,
      sessionIdentityOf(this.adapters.all()),
      threadId,
      place.projectId,
      adapter,
      { id: session.id, cwd },
      offer,
      account,
      facet,
    ).pipe(Effect.mapError((cause) => threadCallFailed(cause)));
    const bound = yield* store.owned(threadId, session.id, ownerId, (current, held) => ({
      ...current,
      session: {
        ...held,
        account: account === null ? undefined : { provider: account.provider, key: account.account },
        package: adapter.package,
      },
    }));
    if (bound === null) return null;
    const answered = launching
      ? yield* this.alignment.align(threadId, session.id, where, cwd, choice)
      : { _tag: 'Aligned' as const, facet: bound };
    if (answered._tag === 'Gone') return null;
    if (answered._tag === 'Uncertain') {
      yield* finish(threadId, session.id, 'failed', `launch-failed: the CLI was not started — ${answered.reason}`);
      return null;
    }
    const aligned = answered.facet;
    const rooted = launching
      ? yield* roots.rootFor(threadId, adapter, aligned, aligned.session!, where, cwd)
      : { _tag: 'Ready' as const, minted: undefined };
    if (rooted._tag === 'Ended') return null;
    const minted = rooted.minted;
    const prepared = yield* store.owned(threadId, session.id, ownerId, (current, held) => {
      const exporter = launch.export;
      const pinned =
        minted === undefined
          ? held
          : { ...held, argv: launch.resume(minted.id, held.prompt.trim() || undefined, choice), prepared: minted };
      const exportPath =
        pinned.exportPath ??
        (exporter === undefined || place.scratch === undefined ? undefined : `${place.scratch}/harness-${pinned.id}.json`);
      const argv =
        pinned.exportPath === undefined && exportPath !== undefined && exporter !== undefined && pinned.argv !== null
          ? exporter(pinned.argv, exportPath)
          : pinned.argv;
      return {
        ...current,
        sessionKey: minted?.id ?? current.sessionKey,
        session: {
          ...pinned,
          cwd: pinned.cwd ?? place.root,
          argv,
          exportPath,
        },
      };
    });
    if (prepared === null) return null;
    if (prepared.session?.state === 'stopping') {
      yield* finish(threadId, session.id, 'aborted', null);
      return null;
    }
    if (launching && declaresExport && session.exportPath !== undefined) {
      const provisioned = yield* roots.provisionPersistedExport(threadId, session.exportPath);
      if (provisioned !== 'ready') {
        yield* this.unsent(threadId, session.id, provisioned.cause, provisioned.reason);
        return null;
      }
    }
    return { adapter, where, prepared, choice } satisfies Ready;
  });

  private readonly dispatch = Effect.fnUntraced(function* (this: SessionLauncher, threadId: string, session: HarnessSession, ready: Ready) {
    const { store, ownerId, finish, uncertain } = this;
    const { where } = ready;
    const attempt = yield* Effect.exit(this.start(threadId, session, ready));
    if (Exit.isFailure(attempt)) {
      if (Cause.hasInterruptsOnly(attempt.cause)) return yield* Effect.failCause(attempt.cause);
      const read = yield* Effect.exit(this.requests.request(where.target.projectId, harnessRunKey(session.id)));
      const unsent =
        Exit.isSuccess(read) && (read.value._tag === 'Unknown' || (read.value._tag === 'Settled' && read.value.execution === undefined));
      if (!unsent) return yield* Effect.failCause(attempt.cause);
      yield* this.unsent(threadId, session.id, attempt.cause);
      return null;
    }
    const started = attempt.value;
    if (started._tag === 'Refused') {
      const line = refusalLine(started.refusal);
      yield* finish(threadId, session.id, 'failed', line.text);
      return null;
    }
    if (started._tag === 'Uncertain') {
      yield* uncertain(threadId, session.id, `The start receipt is unknown; read operation ${started.operation.operation}.`);
      return null;
    }
    if (started._tag === 'Accepted') {
      yield* finish(
        threadId,
        session.id,
        'failed',
        `The host took this terminal launch as bounded command work (${started.record.execution.execution}).`,
      );
      return null;
    }
    const record = started.record;
    const accepted = yield* store.owned(threadId, session.id, ownerId, (current, held) => ({
      ...current,
      execution: { execution: record.execution.execution, incarnation: record.execution.incarnation },
      session: { ...held, state: held.state === 'stopping' ? 'stopping' : 'running' },
    }));
    if (accepted === null) return null;
    return record;
  });

  private start(threadId: string, session: HarnessSession, { adapter, where, prepared, choice }: Ready) {
    const { store, terminals } = this;
    return launchHarness(terminals, where, adapter, prepared, { ...prepared.session!, cwd: prepared.session!.cwd! }, choice, (storage) =>
      store.change(threadId, (current) => {
        const verdict = recordStorageGate(current.session, session.id, storage);
        if (verdict !== 'record' && verdict !== 'keep') return verdict;
        const life = current.session!;
        return Effect.succeed({
          facet: verdict === 'record' ? { ...current, session: { ...life, storage } } : current,
          value: undefined,
        });
      }),
    ).pipe(Effect.mapError((cause) => threadCallFailed(cause)));
  }
}
