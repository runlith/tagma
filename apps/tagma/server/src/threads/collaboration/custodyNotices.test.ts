import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect, Layer, Queue } from 'effect';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import type { CustodyNotice, TerminalDisplaced } from '../../executions/contract/service/custody.js';
import { HOST_REPLACED } from '../../executions/contract/service/custody.js';
import { Custody } from '../../executions/contract/service/custody.js';
import { RETAINED_DETAIL_MS } from '../../executions/contract/wire/requestKeys.js';
import type { CommandSignalOutcome } from './commandEndings.js';
import { makeCustodyNotices } from './custodyNotices.js';
import { TerminalUnavailable } from '../../executions/contract/wire/refusals.js';

const owedAt = (openedAt: number): CustodyNotice => ({
  projectId: 1,
  operationId: 'op-1',
  thread: 'agent-1',
  requester: 'operator',
  execution: { installation: InstallationId.make('i'), execution: ExecutionId.make('exec-1'), incarnation: 0 },
  expected: 0,
  name: 'shell',
  state: 'owed',
  openedAt,
});

const noticesOver = Effect.fnUntraced(function* (displaced: boolean | null, answer: CommandSignalOutcome) {
  const sent: string[] = [];
  const settled: string[] = [];
  const notices = yield* makeCustodyNotices({
    send: (input) =>
      Effect.sync(() => {
        sent.push(input.id);
        return answer;
      }),
  }).pipe(
    Effect.provide(
      Layer.mock(Custody, {
        displaced: yield* Queue.unbounded<TerminalDisplaced>(),
        noticeDecided: (notice) => Effect.succeed({ _tag: 'Owed', notice }),
        stillDisplaced: () => Effect.succeed(displaced),
        noticeDelivered: (notice) =>
          Effect.sync(() => {
            settled.push(notice.operationId);
          }),
      }),
    ),
  );
  return { notices, sent, settled };
});

it.effect('an owed notice whose thread holds the terminal again at send time is removed and never sent', () =>
  Effect.gen(function* () {
    const { notices, sent, settled } = yield* noticesOver(false, { _tag: 'Accepted' });
    expect(yield* notices.deliver(owedAt(yield* Clock.currentTimeMillis))).toBe('delivered');
    expect(sent).toEqual([]);
    expect(settled).toEqual(['op-1']);
  }),
);

it.effect('a custody that cannot be read at send time keeps the notice unsent', () =>
  Effect.gen(function* () {
    const { notices, sent, settled } = yield* noticesOver(null, { _tag: 'Accepted' });
    expect(yield* notices.deliver(owedAt(yield* Clock.currentTimeMillis))).toBe('kept');
    expect(sent).toEqual([]);
    expect(settled).toEqual([]);
  }),
);

it.effect('an unreachable thread keeps its notice inside the retention window and loses it past it', () =>
  Effect.gen(function* () {
    const unreachable = { _tag: 'Unreachable', reason: 'the thread host is down' } as const;
    const fresh = yield* noticesOver(true, unreachable);
    expect(yield* fresh.notices.deliver(owedAt(yield* Clock.currentTimeMillis))).toBe('kept');
    expect(fresh.settled).toEqual([]);

    const old = yield* noticesOver(true, unreachable);
    expect(yield* old.notices.deliver(owedAt((yield* Clock.currentTimeMillis) - RETAINED_DETAIL_MS - 1))).toBe('delivered');
    expect(old.settled).toEqual(['op-1']);
  }),
);

it.effect('a notice owed for a replaced host is sent without reading a custody the new host cannot hold', () =>
  Effect.gen(function* () {
    const { notices, sent, settled } = yield* noticesOver(null, { _tag: 'Accepted' });
    const replaced: CustodyNotice = {
      ...owedAt(yield* Clock.currentTimeMillis),
      operationId: 'replaced:exec-1:0',
      requester: HOST_REPLACED,
    };
    expect(yield* notices.deliver(replaced)).toBe('delivered');
    expect(sent).toEqual(['custody:1:replaced:exec-1:0']);
    expect(settled).toEqual(['replaced:exec-1:0']);
  }),
);

it.effect.each(['read', 'settle'] as const)('a failed notice %s keeps its obligation until a later pass can settle it', (stage) =>
  Effect.gen(function* () {
    let failed = true;
    let closed = false;
    const failure = new TerminalUnavailable({ owner: 'store', message: 'the notice store is unavailable' });
    const context = yield* Layer.build(
      Layer.mock(Custody, {
        displaced: yield* Queue.unbounded<TerminalDisplaced>(),
        noticeDecided: (notice) => (failed && stage === 'read' ? Effect.fail(failure) : Effect.succeed({ _tag: 'Owed', notice })),
        stillDisplaced: () => Effect.succeed(true),
        noticeDelivered: () =>
          failed && stage === 'settle'
            ? Effect.fail(failure)
            : Effect.sync(() => {
                closed = true;
              }),
      }),
    );
    const notices = yield* makeCustodyNotices({ send: () => Effect.succeed({ _tag: 'Accepted' }) }).pipe(Effect.provide(context));
    const notice = owedAt(yield* Clock.currentTimeMillis);
    expect(yield* notices.deliver(notice)).toBe('kept');
    expect(closed).toBe(false);
    failed = false;
    expect(yield* notices.deliver(notice)).toBe('delivered');
    expect(closed).toBe(true);
  }),
);

it.effect('a thread that is gone ends the notice at once', () =>
  Effect.gen(function* () {
    const { notices, sent, settled } = yield* noticesOver(true, { _tag: 'NoThread' });
    expect(yield* notices.deliver(owedAt(yield* Clock.currentTimeMillis))).toBe('delivered');
    expect(sent).toHaveLength(1);
    expect(settled).toEqual(['op-1']);
  }),
);
