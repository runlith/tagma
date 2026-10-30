import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { type McpAppFailure, mcpAppResult, viewCsp } from '@runlith/mcp/apps';
import { McpPool } from '@runlith/mcp/McpPool';
import { mcpRedactor } from '@runlith/mcp/mcpRedactor';
import { mcpDeclarationFingerprint } from '@runlith/mcp/mcpDeclarationFingerprint';
import type { McpResourceEvent } from './contract/wire/feeds.js';
import { Clock, Effect, Exit, FiberSet, Layer, PubSub, Scope, Semaphore, Stream } from 'effect';
import { flight } from '@runlith/held/Flight';
import type { HoldStalled, ReentrantCall } from '@runlith/held/failures';
import { GraphStore, type StoreFailure } from '../platform/contract/service/store.js';
import { writes } from '../platform/contract/service/writes.js';
import { session } from '../platform/store/writers.js';
import { ManagedWrite, type ManagedWriter } from '../settings/contract/service/managed.js';
import { setting } from '../settings/store/table.js';
import type { SettableScope } from '../platform/contract/wire/setting.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { mcpContributionsOff, mcpServers } from './contract/wire/settings.js';
import { Settings } from '../settings/contract/service/values.js';
import { McpContributions, type McpContributionsUnreadable } from './contract/service/contributions.js';
import type { McpServerScope } from './contract/wire/servers.js';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import {
  type McpMount,
  McpServers,
  type McpServerResolution,
  type McpServerSeenInput,
  type McpViewFailure,
  type McpViewRefusal,
  type McpReconcileRefusal,
} from './contract/service/servers.js';
import type { McpSignInRow } from './contract/wire/servers.js';
import { makeSignIns } from './signIns.js';
import { recordOf } from './record.js';
import { McpPlaces } from './contract/service/places.js';
import {
  type Handouts,
  type SecretHolder,
  type SecretOwner,
  SecretOwnerFailed,
  SecretOwners,
} from '../secrets/contract/service/secrets.js';
import {
  declinedRowOf,
  mcpDeclared,
  mcpDeclinedHere,
  rowOf,
  mcpMissingReferences,
  mcpReferences,
  readied,
  type Readied,
} from './declarations.js';

const KIND = 'mcp';

const keyOf = (scope: McpServerScope, projectId: number, name: string): string =>
  scope === 'user' ? `user/${name}` : scope === 'contributed' ? `${projectId}/contributed/${name}` : `${projectId}/${name}`;

const projectOfKey = (key: string): number | null => (key.startsWith('user/') ? null : Number(key.slice(0, key.indexOf('/'))));

const holderOf = (scope: SettableScope, projectId: number, declaration: McpServerDeclaration): SecretHolder => ({
  id: `${scope}/${declaration.name}`,
  key: keyOf(scope, projectId, declaration.name),
  title: declaration.name,
  entries: [...mcpReferences(declaration)].map(([name, places]) => ({ name, description: `Read in ${places.join(', ')}.` })),
});

const storeRefusal = () =>
  new GateRefusal('secret-store-failed', 'The secret store could not be read or written, so no ${NAME} it holds resolves.', [
    'make the file secrets.json in the server’s data directory readable and writable to the server, then repeat',
  ]);

function reached(declaration: McpServerDeclaration): string {
  return declaration.transport === 'stdio' ? declaration.command : declaration.url;
}

type Pooled = {
  readonly pool: McpPool;
  readonly catalogId: number;
  readonly scope: Scope.Closeable;
  readonly secrets: Set<string>;
  readonly keys: Map<string, string>;
  readonly redaction: { of: (text: string) => string };
  narrowed: Set<string> | null;
  reached: Set<string> | null;
};

const whole = (pooled: Pooled): void => {
  pooled.narrowed = null;
};

const kept = (): void => undefined;

const stalledOpen = (stalled: HoldStalled) =>
  Effect.fail(
    new GateRefusal(
      'mcp-reconcile-stalled',
      `Any declaration change already made remains stored, but this project's MCP pool did not open within ${stalled.waitedMs} ms.`,
      ['read_mcp_servers to inspect the stored declaration and current connection state', 'retry once the servers settle'],
    ),
  );

const reentrantOpen = (reentrant: ReentrantCall) =>
  Effect.fail(
    new GateRefusal(
      'mcp-reconcile-stalled',
      `The MCP pool of this project is being opened by the call that asked for it again (${reentrant.key}), so it cannot wait on itself.`,
      ['declare or change the server from outside that MCP server’s own call'],
    ),
  );

const READ_SERVERS = 'read_mcp_servers names the server and its connection state';

const unreadableContributions = (failure: McpContributionsUnreadable) =>
  new GateRefusal('mcp-contributions-unreadable', `The servers contributed to this project could not be read: ${failure.reason}`, [
    'read_plugins names what is enabled in this project and why it does not read',
    'repeat once it reads',
  ]);

const servingRefusal = (failure: McpAppFailure): GateRefusal<McpViewRefusal> => {
  switch (failure._tag) {
    case 'McpToolUnoffered':
      return new GateRefusal('mcp-tool-unoffered', failure.message, ['call a tool whose visibility includes app']);
    case 'McpServerReplaced':
      return new GateRefusal('mcp-server-replaced', failure.message, [
        'open the view again from a call of the server as it is declared now',
      ]);
    case 'McpResourceFailed':
      return new GateRefusal('mcp-resource-failed', failure.message, [READ_SERVERS]);
    case 'McpCallFailed':
    case 'McpTimedOut':
      return new GateRefusal('mcp-call-failed', failure.message, [READ_SERVERS]);
    default:
      return new GateRefusal('mcp-server-unavailable', failure.message, [READ_SERVERS, 'enable_mcp_server to connect it again']);
  }
};

const makeMcpServers = Effect.fnUntraced(function* ({
  environment,
}: {
  readonly environment: Readonly<Record<string, string | undefined>>;
}) {
  const settings = yield* Settings;
  const contributions = yield* McpContributions;
  const places = yield* McpPlaces;
  const owners = yield* SecretOwners;
  const store = yield* GraphStore;
  const managed = yield* ManagedWrite;
  const scope = yield* Scope.fork(yield* Effect.scope, 'parallel');
  const opening = yield* flight<number, McpPool, never>({ name: 'mcp-pool-open', owner: 'mcp', key: String, ceiling: '30 seconds' });
  const pools = new Map<number, Pooled>();
  let catalogIds = 0;
  const moving = yield* FiberSet.makeRuntime<never, void, never>();
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      places.onMoved((projectId) => {
        const held = pools.get(projectId);
        if (held !== undefined) moving(Effect.flatMap(places.of(projectId), held.pool.place));
      }),
    ),
    (release) => Effect.sync(release),
  );

  const handouts = owners.handout(KIND).pipe(Effect.mapError(storeRefusal));

  const pulses = yield* Effect.acquireRelease(PubSub.unbounded<number | null>(), PubSub.shutdown);
  const moved = (projectId: number | null) => PubSub.publish(pulses, projectId).pipe(Effect.asVoid);
  const movedFor = (scope: McpServerScope, projectId: number) => moved(scope === 'user' ? null : projectId);

  const readers = (key: string): ReadonlyArray<readonly [McpPool, string]> =>
    [...pools.values()].flatMap((pooled) =>
      [...pooled.keys].flatMap(([name, held]) => (held === key ? [[pooled.pool, name] as const] : [])),
    );

  const reconnected = (key: string) =>
    Effect.forEach(readers(key), ([pool, name]) => pool.reconnect(name), { concurrency: 'unbounded' }).pipe(
      Effect.map((statuses) => statuses.flatMap((status) => (status === undefined ? [] : [status]))),
    );

  const signIns = yield* makeSignIns({ reconnect: reconnected, moved: (key) => moved(projectOfKey(key)) });

  const masked = (pooled: Pooled, token: string): void => {
    if (pooled.secrets.has(token)) return;
    pooled.secrets.add(token);
    pooled.redaction.of = mcpRedactor([...pooled.secrets]);
  };

  const settling = new Map<number, Semaphore.Semaphore>();
  const serialOf = (projectId: number): Semaphore.Semaphore => {
    const standing = settling.get(projectId);
    if (standing !== undefined) return standing;
    const made = Semaphore.makeUnsafe(1);
    settling.set(projectId, made);
    return made;
  };

  const resolver = (given: Handouts, projectId: number, entry: McpServerResolution) => {
    const { values } = given(keyOf(entry.scope, projectId, entry.declaration.name));
    return (name: string) => values[name] ?? environment[name];
  };

  const readyOf = (given: Handouts, projectId: number, entry: McpServerResolution): Readied =>
    readied(entry, resolver(given, projectId, entry));

  const declaredOf = Effect.fnUntraced(function* (projectId: number) {
    const read = yield* settings.read(mcpServers, projectId);
    const entries = yield* contributions.of(projectId).pipe(Effect.mapError(unreadableContributions));
    const off = yield* settings.value(mcpContributionsOff, projectId);
    return { read, declared: mcpDeclared(read, { entries, off }) };
  });

  const signInRow = Effect.fnUntraced(function* (given: Handouts, key: string, now: number) {
    const record = yield* recordOf(key, given(key).signIn).pipe(Effect.mapError(storeRefusal));
    const row: McpSignInRow = {
      signedIn: record.tokens !== undefined,
      pending: signIns.pending(key, now),
      client: record.client?.kind ?? null,
      redirect: null,
    };
    return row;
  });

  const list: McpServers['Service']['list'] = Effect.fn('McpServers.list')(function* (projectId) {
    const { read, declared: resolved } = yield* declaredOf(projectId);
    const given = yield* handouts;
    const measured = new Map((pools.get(projectId)?.pool.states() ?? []).map((state) => [state.name, state]));
    const now = yield* Clock.currentTimeMillis;
    const effective = yield* Effect.forEach(resolved, (entry) =>
      Effect.map(
        entry.declaration.transport === 'http'
          ? signInRow(given, keyOf(entry.scope, projectId, entry.declaration.name), now)
          : Effect.succeed(undefined),
        (signIn) => rowOf(entry, measured.get(entry.declaration.name), now, readyOf(given, projectId, entry), signIn),
      ),
    );
    return [...effective, ...mcpDeclinedHere(read).map((entry) => declinedRowOf(entry, now))];
  });

  const rows: McpServers['Service']['rows'] = (projectId) =>
    Stream.unwrap(
      Effect.map(PubSub.subscribe(pulses), (moves) =>
        Stream.concat(
          Stream.succeed(projectId),
          Stream.fromSubscription(moves).pipe(
            Stream.filter((moved) => moved === null || moved === projectId),
            Stream.buffer({ capacity: 1, strategy: 'sliding' }),
          ),
        ).pipe(Stream.mapEffect(() => list(projectId))),
      ),
    );

  const declaredIn = Effect.fnUntraced(function* (input: McpServerSeenInput & { readonly name: string }) {
    const effective = (yield* declaredOf(input.projectId)).declared;
    const entry = effective.find((candidate) => candidate.declaration.name === input.name && candidate.scope === input.scope);
    if (entry !== undefined) return entry;
    const elsewhere = effective.find((candidate) => candidate.declaration.name === input.name);
    return yield* new GateRefusal(
      'mcp-server-unknown',
      `${input.scope} scope holds no server called ${input.name} that this project resolves to.`,
      elsewhere === undefined
        ? ['read_mcp_servers names every server this project resolves to']
        : [`${input.name} stands in ${elsewhere.scope} scope; name that scope`],
    );
  });

  const signIn: McpServers['Service']['signIn'] = Effect.fn('McpServers.signIn')(function* (input) {
    const entry = yield* declaredIn(input);
    const { declaration } = entry;
    if (declaration.transport !== 'http') {
      return yield* new GateRefusal(
        'mcp-sign-in-unsupported',
        `${input.name} runs as a program on this machine; only an HTTP server signs in.`,
        ['give a stdio server its keys as ${NAME} values on its card'],
      );
    }
    const given = yield* handouts;
    const missing =
      entry.scope === 'contributed'
        ? []
        : mcpMissingReferences({ ...declaration, headers: undefined }, resolver(given, input.projectId, entry));
    if (missing.length > 0) {
      return yield* new GateRefusal('mcp-sign-in-unsupported', `The URL of ${input.name} still needs ${missing.join(', ')}.`, [
        `set ${missing.join(', ')} on the server's card, then sign in`,
      ]);
    }
    const asked = pools
      .get(input.projectId)
      ?.pool.states()
      .find((state) => state.name === input.name)?.failure;
    const expanded = readyOf(given, input.projectId, entry).declaration;
    return yield* signIns.begin({
      key: keyOf(input.scope, input.projectId, input.name),
      name: input.name,
      projectId: input.projectId,
      url: expanded.transport === 'http' ? expanded.url : declaration.url,
      redirect: input.redirect,
      challenge: asked?._tag === 'McpNeedsSignIn' ? { scope: asked.scope, resourceMetadata: asked.resourceMetadata } : {},
      client: input.client,
    });
  });

  const signOut: McpServers['Service']['signOut'] = Effect.fn('McpServers.signOut')(function* (input) {
    yield* declaredIn(input);
    yield* signIns.signOut(keyOf(input.scope, input.projectId, input.name));
    yield* movedFor(input.scope, input.projectId);
    return yield* list(input.projectId);
  });

  const add: McpServers['Service']['add'] = Effect.fn('McpServers.add')(function* (input) {
    const declaration: McpServerDeclaration = { ...input.declaration, version: 1 };
    const listing = list(input.projectId);
    const reconciling = reaching(input.scope, input.projectId);

    yield* settings.amend(mcpServers, input.scope, input.projectId, (current) => {
      const standing = current.find((entry) => entry.name === declaration.name);
      if (standing === undefined) return Effect.succeed([...current, declaration]);
      return Effect.fail(
        new GateRefusal('mcp-server-exists', `${input.scope} scope already declares ${standing.name}, reached at ${reached(standing)}.`, [
          `drop the standing one with remove_mcp_server naming ${standing.name}, then declare this one`,
          'or declare this server under a name of its own',
        ]),
      );
    });
    yield* reconciling;
    yield* Effect.forEach(readers(keyOf(input.scope, input.projectId, declaration.name)), ([pool, name]) => pool.awaitHandshake(name), {
      concurrency: 'unbounded',
      discard: true,
    });
    yield* movedFor(input.scope, input.projectId);
    return yield* listing;
  });

  const remove: McpServers['Service']['remove'] = Effect.fn('McpServers.remove')(function* (input) {
    const listing = list(input.projectId);
    const reconciling = reaching(input.scope, input.projectId);

    const { read: resolved, declared } = yield* declaredOf(input.projectId);
    const named = (resolved.layers[input.scope]?.value ?? []).some((entry) => entry.name === input.name);
    const contributed = declared.find((entry) => entry.declaration.name === input.name && entry.scope === 'contributed');
    if (!named && contributed !== undefined) {
      return yield* new GateRefusal(
        'mcp-server-contributed',
        `${input.name} is contributed to this project by ${contributed.contributor ?? 'what is enabled here'}, and no scope declares it, so there is nothing to drop.`,
        [
          `enable_mcp_server with scope contributed and enabled false keeps ${input.name} out of this project`,
          `turn off ${contributed.contributor ?? 'what contributes it'} in this project to withdraw everything it contributes`,
        ],
      );
    }
    const elsewhere = declared.find((entry) => entry.declaration.name === input.name);
    if (named) {
      const key = keyOf(input.scope, input.projectId, input.name);
      yield* signIns.forget(key);
      yield* owners.drop(KIND, key).pipe(Effect.mapError(storeRefusal));
    }
    yield* settings.amend(mcpServers, input.scope, input.projectId, (current) => {
      if (current.some((entry) => entry.name === input.name)) {
        return Effect.succeed(current.filter((entry) => entry.name !== input.name));
      }
      return Effect.fail(
        new GateRefusal(
          'mcp-server-unknown',
          `${input.scope} scope declares no server called ${input.name}.`,
          elsewhere === undefined
            ? ['read_mcp_servers names every server this project resolves to']
            : [`${input.name} stands in ${elsewhere.scope} scope; name that scope to drop it there`],
        ),
      );
    });
    yield* reconciling;
    yield* movedFor(input.scope, input.projectId);
    return yield* listing;
  });

  const setEnabled: McpServers['Service']['setEnabled'] = Effect.fn('McpServers.setEnabled')(function* (input) {
    const listing = list(input.projectId);
    const reconciling = reaching(input.scope, input.projectId);

    const entries = (yield* declaredOf(input.projectId)).declared;
    const elsewhere = entries.find((entry) => entry.declaration.name === input.name);
    const unknown = () =>
      new GateRefusal(
        'mcp-server-unknown',
        `${input.scope} scope holds no server called ${input.name}.`,
        elsewhere === undefined
          ? ['read_mcp_servers names every server this project resolves to']
          : [`${input.name} stands in ${elsewhere.scope} scope; name that scope to switch it there`],
      );
    const scope = input.scope;
    if (scope === 'contributed') {
      const offered = (yield* contributions.of(input.projectId).pipe(Effect.mapError(unreadableContributions))).some(
        (entry) => entry.declaration.name === input.name,
      );
      if (!offered) return yield* unknown();
      yield* settings.amend<readonly string[], never>(mcpContributionsOff, 'project', input.projectId, (current) =>
        Effect.succeed(input.enabled ? current.filter((name) => name !== input.name) : [...new Set([...current, input.name])]),
      );
    } else {
      yield* settings.amend(mcpServers, scope, input.projectId, (current) => {
        if (!current.some((entry) => entry.name === input.name)) return Effect.fail(unknown());
        return Effect.succeed(current.map((entry) => (entry.name === input.name ? { ...entry, enabled: input.enabled } : entry)));
      });
    }
    yield* reconciling;
    yield* movedFor(input.scope, input.projectId);
    return yield* listing;
  });

  const reconcile: McpServers['Service']['reconcile'] = Effect.fn('McpServers.reconcile')(function* (projectId) {
    yield* settle(projectId, whole);
    yield* pools.get(projectId)?.pool.awaitHandshakes() ?? Effect.void;
  });

  const settle = Effect.fn('McpServers.settle')(
    function* (
      projectId: number,
      widen: (pooled: Pooled) => void,
      openOnly = false,
    ): Effect.fn.Return<void, StoreFailure | GateRefusal<McpReconcileRefusal>> {
      if (openOnly && !pools.has(projectId)) return;
      const pool = poolOf(projectId);

      const given = yield* handouts;
      const standing = (yield* declaredOf(projectId)).declared.flatMap((entry) => {
        const ready = readyOf(given, projectId, entry);
        return ready.needs.length === 0 ? [{ entry, ready }] : [];
      });
      const opened = yield* pool.pipe(Effect.catchTags({ HoldStalled: stalledOpen, ReentrantCall: reentrantOpen }));
      keep(
        projectId,
        standing.flatMap(({ entry, ready }) => [...ready.values, ...given(keyOf(entry.scope, projectId, entry.declaration.name)).redact]),
      );
      const pooled = pools.get(projectId);
      const owners = new Map(pooled?.keys ?? []);
      if (pooled !== undefined) {
        widen(pooled);
        pooled.keys.clear();
        for (const { entry } of standing) pooled.keys.set(entry.declaration.name, keyOf(entry.scope, projectId, entry.declaration.name));
      }
      const narrowed = pooled?.narrowed ?? null;
      const wanted = narrowed === null ? null : [...narrowed];
      const started = narrowed === null ? standing : standing.filter(({ entry }) => narrowed.has(entry.declaration.name));
      const running = new Map(opened.states().map((state) => [state.name, state.identity]));
      const reowned = started.flatMap(({ entry, ready }) => {
        const name = entry.declaration.name;
        const before = owners.get(name);
        const kept = running.get(name) === mcpDeclarationFingerprint(ready.declaration);
        return before !== undefined && kept && before !== keyOf(entry.scope, projectId, name) ? [name] : [];
      });
      yield* opened.reconcile(started.map(({ ready }) => ready.declaration)).pipe(
        Effect.andThen(Effect.forEach(reowned, (name) => opened.reconnect(name), { discard: true })),
        Effect.catchTags({
          HoldStalled: (stalled) =>
            Effect.fail(
              new GateRefusal(
                'mcp-reconcile-stalled',
                `Any declaration change already made remains stored, but the MCP server list could not be reconciled: an earlier pass held the pool for ${stalled.waitedMs} ms.`,
                [
                  'read_mcp_servers to inspect the stored declaration and current connection state',
                  'after the servers settle, use enable_mcp_server on a stored server to retry reconciliation; stop or restart one that remains stuck',
                ],
              ),
            ),
          HoldCut: (cut) =>
            Effect.fail(
              new GateRefusal(
                'mcp-reconcile-stalled',
                `Any declaration change already made remains stored, but the MCP server pass was cut after ${cut.heldMs} ms; ${cut.leaves}.`,
                [
                  'read_mcp_servers to inspect the stored declaration and current connection state',
                  'stop or restart a stuck server with enable_mcp_server, then retry reconciliation once the servers settle',
                ],
              ),
            ),
        }),
      );
      if (pooled === undefined) return;
      if (wanted === null) pooled.reached = null;
      else for (const name of wanted) pooled.reached?.add(name);
    },
    (effect, projectId) => serialOf(projectId).withPermit(effect),
  );

  const keep = (projectId: number, values: readonly string[]): void => {
    const entry = pools.get(projectId);
    if (entry === undefined) return;
    const before = entry.secrets.size;
    for (const value of values) entry.secrets.add(value);
    if (entry.secrets.size !== before) entry.redaction.of = mcpRedactor([...entry.secrets]);
  };

  const reconcileAll: McpServers['Service']['reconcileAll'] = Effect.fn('McpServers.reconcileAll')(() =>
    Effect.suspend(() => Effect.forEach([...pools.keys()], (projectId) => settle(projectId, kept))),
  );

  const contributionsMoved = Effect.fn('McpServers.contributionsMoved')(function* (projectId: number | null) {
    const touched = projectId === null ? [...settling.keys()] : [projectId];
    yield* Effect.forEach(touched, (id) => settle(id, kept, true), { discard: true });
    yield* moved(projectId);
  });

  yield* Effect.forkScoped(
    Stream.runForEach(contributions.changes, (projectId) =>
      contributionsMoved(projectId).pipe(
        Effect.catch((failure) =>
          Effect.andThen(
            Effect.logWarning('the MCP pool kept its servers: the contributions that moved could not be reconciled', {
              projectId,
              failure: failure.message,
            }),
            moved(projectId),
          ),
        ),
      ),
    ),
  );

  const reaching = (scope: McpServerScope, projectId: number): Effect.Effect<void, StoreFailure | GateRefusal<McpReconcileRefusal>> => {
    if (scope === 'user') return reconcileAll();
    return Effect.suspend(() => settle(projectId, pools.has(projectId) ? kept : whole));
  };

  const palette: McpServers['Service']['palette'] = (projectId) => pools.get(projectId)?.pool.paletteUnsafe() ?? [];
  const catalogRevision: McpServers['Service']['catalogRevision'] = (projectId) => {
    const held = pools.get(projectId);
    return held === undefined ? 'none' : `${held.catalogId}:${held.pool.catalogRevisionUnsafe()}`;
  };

  const caller: McpServers['Service']['caller'] = (projectId) => {
    const pool = poolOf(projectId);
    return {
      call: (server, tool, args, options) => Effect.flatMap(pool, (opened) => opened.call(server, tool, args, options)),
    };
  };

  const appView: McpServers['Service']['appView'] = Effect.fn('McpServers.appView')((mount, resource, tool) => {
    return serving(mount, (pool) =>
      Effect.map(pool.appView(mount, resource, tool), (view) => ({
        ...view,
        meta: { ...view.meta, csp: view.meta.csp === undefined ? undefined : viewCsp(view.meta.csp) },
      })),
    );
  });

  const appRead: McpServers['Service']['appRead'] = Effect.fn('McpServers.appRead')((mount, uri, caller) => {
    return serving(mount, (pool) => pool.appRead(mount, uri, { caller }));
  });

  const appCall: McpServers['Service']['appCall'] = Effect.fn('McpServers.appCall')((mount, tool, args, caller) => {
    return serving(mount, (pool) => Effect.map(pool.appCall(mount, tool, args, { caller }), mcpAppResult));
  });

  const appWatch: McpServers['Service']['appWatch'] = (mount, uri, caller) => {
    const held = (opening: McpResourceEvent): Stream.Stream<McpResourceEvent, McpViewFailure> =>
      Stream.unwrap(
        serving(mount, (pool) =>
          Effect.map(pool.appSubscribe(mount, uri, { caller }), (updates) =>
            Stream.concat(
              Stream.succeed(opening),
              Stream.map(updates, (update): McpResourceEvent => ({ kind: 'updated', ...update })),
            ),
          ),
        ),
      );
    const again = (): Stream.Stream<McpResourceEvent, McpViewFailure> =>
      Stream.concat(
        held({ kind: 'updated', uri }),
        Stream.suspend(() => again()),
      );
    return Stream.concat(
      held({ kind: 'subscribed' }),
      Stream.suspend(() => again()),
    );
  };

  const reachedPool = (projectId: number, server: string) =>
    Effect.suspend(() => {
      const held = pools.get(projectId);
      if (held !== undefined && (held.reached === null || held.reached.has(server))) return Effect.succeed(held.pool);
      const widened = settle(projectId, (pooled) => pooled.narrowed?.add(server));
      return Effect.andThen(widened, poolOf(projectId));
    }).pipe(Effect.catchTags({ HoldStalled: stalledOpen, ReentrantCall: reentrantOpen }));

  const serving = <A, R>(
    mount: McpMount,
    work: (pool: McpPool) => Effect.Effect<A, McpAppFailure, R>,
  ): Effect.Effect<A, McpViewFailure, R> =>
    Effect.flatMap(reachedPool(mount.projectId, mount.server), (pool) => work(pool).pipe(Effect.mapError(servingRefusal)));

  const raise: McpServers['Service']['raise'] = Effect.fn('McpServers.raise')(function* (projectId, name) {
    yield* (yield* reachedPool(projectId, name)).awaitHandshake(name);
    return yield* list(projectId);
  });

  const release: McpServers['Service']['release'] = Effect.fn('McpServers.release')((projectId) => {
    return Effect.suspend(() => {
      const held = pools.get(projectId);
      pools.delete(projectId);
      settling.delete(projectId);
      return held === undefined ? Effect.void : Scope.close(held.scope, Exit.void);
    });
  });

  const poolOf = Effect.fn('McpServers.poolOf')((projectId: number): Effect.Effect<McpPool, HoldStalled | ReentrantCall> => {
    return Effect.suspend(() => {
      const standing = pools.get(projectId);
      if (standing !== undefined) return Effect.succeed(standing.pool);
      return opening.join(
        projectId,
        Effect.suspend(() => {
          const held = pools.get(projectId);
          if (held !== undefined) return Effect.succeed(held.pool);
          return Effect.gen(function* () {
            const own = yield* Scope.fork(scope);
            const keys = new Map<string, string>();
            const redaction = { of: (text: string) => text };
            let pooled: Pooled | undefined;
            const pool = yield* Scope.provide(
              McpPool.make({
                redact: (text) => redaction.of(text),
                auth: (name) => {
                  const key = keys.get(name);
                  return key === undefined
                    ? undefined
                    : signIns.auth(key, (token) => {
                        if (pooled !== undefined) masked(pooled, token);
                      });
                },
              }),
              own,
            );
            yield* pool.place(yield* places.of(projectId));
            yield* Effect.forkIn(
              Stream.runForEach(pool.changes, () => moved(projectId)),
              own,
            );
            catalogIds += 1;
            pooled = {
              pool,
              catalogId: catalogIds,
              scope: own,
              secrets: new Set(),
              keys,
              redaction,
              narrowed: new Set(),
              reached: new Set(),
            };
            pools.set(projectId, pooled);
            yield* moved(projectId);
            return pool;
          });
        }),
      );
    });
  });
  const ownerFailed = (failure: { readonly message: string }) =>
    new SecretOwnerFailed({
      reason: `The MCP servers reading this value could not be reconciled: ${failure.message}`,
      unblock: ['read_mcp_servers names each server’s state', 'enable_mcp_server on the server connects it again'],
    });

  const owner: SecretOwner = {
    kind: KIND,
    holders: Effect.fn('McpServers.holders')(
      function* (projectId: number) {
        const resolved = yield* settings.read(mcpServers, projectId);
        const own = resolved.layers.project;
        const user = own?.declined === true ? [] : (resolved.layers.user?.value ?? []);
        return [
          ...user.map((declaration) => holderOf('user', projectId, declaration)),
          ...(own?.value ?? []).map((declaration) => holderOf('project', projectId, declaration)),
        ];
      },
      (effect) =>
        Effect.mapError(
          effect,
          (failure) =>
            new SecretOwnerFailed({
              reason: `The MCP declarations could not be read: ${failure.message}`,
              unblock: ['repeat once the settings store answers'],
            }),
        ),
    ),
    changed: Effect.fn('McpServers.changed')(
      function* (key: string) {
        const projectId = projectOfKey(key);
        const reads = Effect.fnUntraced(function* (id: number) {
          const effective = mcpDeclared(yield* settings.read(mcpServers, id));
          return effective.some((entry) => keyOf(entry.scope, id, entry.declaration.name) === key);
        });
        const open = projectId === null ? [...pools.keys()] : pools.has(projectId) ? [projectId] : [];
        const touched = yield* Effect.filter(open, reads);
        yield* Effect.forEach(touched, (id) => settle(id, kept), { discard: true });
        yield* Effect.forEach(touched, (id) => pools.get(id)?.pool.awaitHandshakes() ?? Effect.void, { discard: true });
        yield* moved(projectId);
      },
      (effect) => Effect.mapError(effect, ownerFailed),
    ),
  };

  const decline: ManagedWriter<readonly McpServerDeclaration[]> = Effect.fn('McpServers.decline')(function* (input) {
    if (input.scope !== 'project' || input.projectId === null || input.value !== undefined || input.declinedGiven !== true) {
      return yield* new GateRefusal(
        'setting-managed',
        `${mcpServers.id} lists the servers add_mcp_server declares and remove_mcp_server drops; this door only lets a project decline the operator's own servers, keeping its own.`,
        ['send declined alone, in project scope', 'add_mcp_server and remove_mcp_server change the servers themselves'],
      );
    }
    const projectId = input.projectId;
    yield* store.transaction(writes('settings', [session, setting]), (unit) => managed.write(unit, { ...input, kept: true }), {
      onCommit: (written) => Effect.andThen(written.announce, moved(projectId)),
    });
    yield* Effect.andThen(
      settle(projectId, kept, true),
      Effect.suspend(() => pools.get(projectId)?.pool.awaitHandshakes() ?? Effect.void),
    ).pipe(
      Effect.catchTag('GateRefusal', (refusal) =>
        Effect.fail(
          new GateRefusal(
            'setting-unapplied',
            `The project ${input.declined ? 'declines' : 'takes'} the operator's MCP servers now, but its pool did not follow: ${refusal.message}`,
            ['read_mcp_servers names each server’s state', 'the next thread turn reconciles the pool again'],
          ),
        ),
      ),
    );
    yield* moved(projectId);
  });

  return {
    owner,
    decline,
    servers: McpServers.of({
      list,
      rows,
      moves: Effect.map(PubSub.subscribe(pulses), Stream.fromSubscription),
      opened: () => [...pools.keys()],
      add,
      remove,
      setEnabled,
      signIn,
      signOut,
      forgetContributed: Effect.fn('McpServers.forgetContributed')(function* (brought: (name: string) => boolean) {
        for (const key of yield* owners.keys(KIND).pipe(Effect.mapError(storeRefusal))) {
          const name = /^\d+\/contributed\/(.+)$/u.exec(key)?.[1];
          if (name === undefined || !brought(name)) continue;
          yield* signIns.forget(key);
          yield* owners.drop(KIND, key).pipe(Effect.mapError(storeRefusal));
        }
      }),
      finishSignIn: signIns.finish,
      reconcile,
      reconcileAll,
      raise,
      palette,
      catalogRevision,
      caller,
      appView,
      appRead,
      appCall,
      appWatch,
      release,
    }),
  };
});

export const mcpServersLayer = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Layer.Layer<McpServers, never, Settings | ProjectChanges | McpPlaces | McpContributions | SecretOwners | GraphStore | ManagedWrite> =>
  Layer.effect(
    McpServers,
    Effect.gen(function* () {
      const { servers, owner, decline } = yield* makeMcpServers({ environment });
      yield* (yield* ManagedWrite).register(mcpServers, decline);
      const unsubscribe = (yield* ProjectChanges).removed.subscribe(({ projectId }) => servers.release(projectId));
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      yield* Effect.acquireRelease((yield* SecretOwners).register(owner), (withdraw) => Effect.sync(withdraw));
      return servers;
    }),
  );
