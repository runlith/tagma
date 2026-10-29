import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { TerminalUnavailable } from './contract/wire/refusals.js';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import type { ListenerReport, ListenerSnapshot } from '@runlith/executions/protocol/evidence';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { ServedRoots } from '../browser/contract/service/sources.js';
import { MachineUnits, unitOf } from '../platform/contract/service/units.js';
import { TargetKey } from './contract/wire/targets.js';
import type { TerminalRecord } from './contract/wire/terminals.js';
import { TerminalRows } from './store/terminalRows.js';
import { unreadHost } from './testing/doubles.js';
import { makeTerminalInventory, TerminalInventory } from './terminals/inventory.js';
import { makeServedRoots } from './servedRoots.js';

it.effect('serving roots use retained local listener ownership and targeted terminal records without probing the host', () =>
  Effect.gen(function* () {
    const execution = { installation: InstallationId.make('local'), execution: ExecutionId.make('dev'), incarnation: 1 };
    const principal = Principal.make('operator');
    let record: TerminalRecord = {
      execution,
      projectId: 1,
      transport: 'pty',
      lifetime: 'held',
      targetKey: TargetKey.make('dev'),
      holder: principal,
      origin: principal,
      revision: 0,
      holdings: {},
      cwd: '/checkout/app',
      acceptedAt: 0,
    };
    const summary: ExecutionSummary = {
      state: {
        ref: execution,
        transport: 'pty',
        lifetime: 'held',
        purpose: 'internal',
        phase: 'running',
        streams: { stdout: 'open', stderr: 'open', pty: 'open' },
        cleanup: 'pending',
        record: 'available',
      },
      custody: {
        revision: 0,
        holder: principal,
        origin: principal,
        target: { environment: 'host', namespace: 'host', cwd: '/checkout/app', dependencies: [] },
      },
      streams: [],
      native: {},
    };
    const scope = { host: { _tag: 'Local', machine: 'host' }, network: { _tag: 'Local', machine: 'host' } } as const;
    const observation = {
      scope,
      source: { adapter: 'kernel', probe: 'sockets' },
      observedAt: 1,
      completeness: 'complete',
      unmeasured: [],
    } as const;
    const socket: ListenerSnapshot = {
      ...observation,
      protocol: 'tcp',
      address: '127.0.0.1',
      port: 5173,
      holder: { pid: 10, birth: 'start' },
      association: { execution, relation: 'ancestry', identity: 'same' },
    };
    let report: ListenerReport = { ...observation, subject: { _tag: 'Namespace' }, revision: 1, listeners: [socket] };
    let summaries: readonly ExecutionSummary[] = [summary];
    let retainedOnly = false;
    const hostRead = <A>(value: A) => (retainedOnly ? Effect.die('a pick must not probe the host') : Effect.succeed(value));
    const inventory = yield* makeTerminalInventory({
      executions: {
        ...unreadHost,
        generation: () => hostRead(1),
        changes: () => hostRead({ _tag: 'Changed' as const, revision: 1, executions: summaries, left: [] }),
        hostListeners: () => hostRead(report),
      },
    });
    const unread = () => Effect.die('serving roots must not list all terminals');
    let failing = false;
    const rows: TerminalRows = {
      records: (_unit, ids) =>
        failing
          ? Effect.fail(new TerminalUnavailable({ owner: 'store', message: 'store down' }))
          : Effect.succeed(new Map(ids.filter((id) => id === execution.execution).map((id) => [id, record]))),
      project: unread,
      record: unread,
      shell: unread,
      inventory: unread,
      heldBy: unread,
      holdingUses: unread,
      standing: unread,
      held: unread,
      openNotice: unread,
      noticeReplaced: unread,
      markNotice: unread,
      notices: unread,
      notice: unread,
      markWriter: unread,
      writers: unread,
    };
    const unit = unitOf<'machine'>({ store: { path: 'memory', generation: 1 }, run: (query) => query });
    const units = MachineUnits.of({
      read: (work) => work(unit),
      write: unread,
      markReadOnly: (effect) => effect,
      markWrite: (effect) => effect,
    });
    const roots = yield* makeServedRoots.pipe(
      Effect.provide(Context.make(TerminalInventory, inventory).pipe(Context.add(TerminalRows, rows), Context.add(MachineUnits, units))),
    );
    const port = Context.make(ServedRoots, roots);
    const root = (projectId = 1, origin = 'http://localhost:5173') =>
      Effect.flatMap(ServedRoots, (served) => served.root(projectId, origin)).pipe(Effect.provide(port));
    expect(yield* root()).toBeNull();
    yield* inventory.of(1);
    yield* inventory.refresh();
    retainedOnly = true;
    expect(yield* root()).toBe('/checkout/app');
    expect(yield* root(2)).toBeNull();
    expect(yield* root(1, 'http://example.com:5173')).toBeNull();
    expect(yield* root(1, 'http://127.0.0.1:5174')).toBeNull();
    record = { ...record, projectId: 2 };
    expect(yield* root()).toBeNull();
    record = { ...record, projectId: 1, execution: { ...execution, incarnation: 2 } };
    expect(yield* root()).toBeNull();
    record = { ...record, execution };
    failing = true;
    const failed = yield* Effect.result(root());
    expect(failed._tag).toBe('Failure');
    if (failed._tag === 'Failure') expect(failed.failure._tag).toBe('ServingUnread');
    failing = false;
    retainedOnly = false;
    report = { ...report, listeners: [socket, { ...socket, association: undefined }] };
    yield* inventory.refresh();
    retainedOnly = true;
    expect(yield* root()).toBeNull();
    retainedOnly = false;
    const other = { ...execution, execution: ExecutionId.make('other') };
    summaries = [summary, { ...summary, state: { ...summary.state, ref: other } }];
    report = { ...report, listeners: [socket, { ...socket, association: { execution: other, relation: 'ancestry', identity: 'same' } }] };
    yield* inventory.refresh();
    retainedOnly = true;
    expect(yield* root()).toBeNull();
    retainedOnly = false;
    report = { ...report, listeners: [socket], scope: { host: scope.host, network: { _tag: 'Foreign', kind: 'guest', id: 'container' } } };
    yield* inventory.refresh();
    retainedOnly = true;
    expect(yield* root()).toBeNull();
    inventory.forget(1);
    expect(yield* root()).toBeNull();
  }),
);
