import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import type { LoadSubscription } from '@runlith/executions/ExecutionEvidence';
import type { DeclaredPart, LoadGroup, LoadReading } from '@runlith/executions/protocol/evidence';
import { Context, Effect, Fiber, Layer, Queue, Stream } from 'effect';
import { Hosts } from '../../browser/contract/service/hosts.js';
import { Pages } from '../../browser/contract/service/pages.js';
import { Seeded } from '../../browser/testing/world.js';
import { DESKTOP } from '../../desktop-browser/contract/wire/channel.js';
import { fakeHost } from '../../desktop-browser/testing/fakeHost.js';
import { ServedChannel, servedChannelOver } from '../../desktop-browser/testing/served.js';
import { desktopWorld } from '../../desktop-browser/testing/world.js';
import type { Background } from '../../platform/contract/service/background.js';
import type { WindowDeclaration } from '../contract/wire/load.js';
import { makeHostLoad, makeMachineLoad } from './feed.js';
import { makeWindowDeclarations, partNames } from './windows.js';
import { appTitleKey, type WorkNames } from './work.js';

const machine = { _tag: 'Local', machine: 'fixture' } as const;

const names: WorkNames = {
  read: (_refs, _now, views) =>
    Effect.succeed({
      work: new Map(),
      threads: new Map(),
      apps: new Map(views.map((view) => [appTitleKey(view), 'Notes'])),
      unread: undefined,
    }),
};

const background: Background['Service'] = { run: () => Effect.die('no background work runs here'), standing: Effect.succeed([]) };

const groupOf = (part: DeclaredPart): LoadGroup => ({
  owner: { _tag: 'Part', key: part.key },
  cores: 1,
  gpuCores: 0,
  gpuMeasured: 0,
  gpuUnread: 1,
  memoryBytes: 100,
  unread: 0,
  processes: [
    {
      identity: { pid: part.pid, birth: `${part.pid}:0` },
      parent: 1,
      name: `p${part.pid}`,
      cores: 1,
      gpu: { _tag: 'Unavailable', reason: 'not measured' },
      memoryBytes: 100,
      signal: true,
    },
  ],
});

const readingOf = (parts: readonly DeclaredPart[]): LoadReading => ({
  scope: { host: machine, network: machine },
  observedAt: 1,
  revision: 1,
  takenAtMicros: 1,
  overMicros: 1_000_000,
  cores: 10,
  machineName: 'Computer',
  unresolvedParts: [],
  cpu: parts.length,
  memory: {
    _tag: 'Measured',
    totalBytes: 1_000_000,
    usedBytes: 1,
    availableBytes: 1,
    source: { adapter: 'a', probe: 'p' },
    pressure: { _tag: 'Unknown', reason: 'unknown', detail: '' },
  },
  groups: parts.map(groupOf),
});

const member = (pid: number, kind: 'main' | 'graphics' | 'renderer', documents: WindowDeclaration['processes'][number]['documents']) => ({
  pid,
  createdMs: 1_000 + pid,
  kind,
  documents,
});

layer(desktopWorld('load-chain-'), { excludeTestServices: true })('the window declaration chain', (it) => {
  it.effect(
    'a declaration sent from the desktop becomes the parts the host subscription admits, and rows named by their documents follow its replacements and the generation ending',
    () =>
      Effect.gen(function* () {
        const pages = yield* Pages;
        const seeded = yield* Seeded;
        const windows = yield* makeWindowDeclarations;
        const url = Context.get(yield* Layer.build(servedChannelOver(windows)), ServedChannel).url;
        const fake = yield* fakeHost(url);
        const live = yield* fake.called;
        fake.answer(live.id, []);
        yield* (yield* Hosts).reach(DESKTOP);
        const opening = yield* Effect.forkChild(
          pages.open({ projectId: seeded.id, thread: null, human: true }, { url: 'https://example.com/docs', profile: undefined }),
        );
        for (let call = yield* fake.called; ; call = yield* fake.called) {
          fake.answer(call.id, call.call.kind === 'open' ? { restricted: false, revision: 0 } : null);
          if (call.call.kind === 'open') break;
        }
        const page = (yield* Fiber.join(opening)).id;

        const readings = yield* Queue.unbounded<LoadReading>();
        const host = yield* makeHostLoad(
          (admitted) =>
            Effect.as(Queue.offer(readings, readingOf(admitted)), {
              readings: Stream.fromQueue(readings),
              setParts: (parts) => Effect.asVoid(Queue.offer(readings, readingOf(parts))),
              setInterest: () => Effect.void,
            } satisfies LoadSubscription),
          windows,
        );
        const feed = yield* makeMachineLoad(host, names, background, partNames(windows, pages));

        const declaration = (...rest: WindowDeclaration['processes']): WindowDeclaration => ({
          precisionMs: 10,
          processes: [member(200, 'main', []), member(201, 'graphics', []), ...rest],
        });
        fake.sent({
          kind: 'declaration',
          seq: fake.next(),
          declaration: declaration(
            member(202, 'renderer', [{ _tag: 'Page', page }]),
            member(203, 'renderer', [{ _tag: 'AppView', project: seeded.id, app: 'notes', view: 'board' }]),
            member(204, 'renderer', [{ _tag: 'McpView', server: 'linear' }]),
          ),
        });
        yield* Stream.runHead(Stream.filter(windows.parts, (parts) => parts.length === 5));

        const rows = yield* Queue.unbounded<ReadonlyArray<{ readonly kind: string; readonly title: string; readonly close?: unknown }>>();
        yield* Effect.forkScoped(
          Stream.runForEach(feed.machine(), (frame) => {
            const state = frame._tag === 'Snapshot' ? frame.snapshot.state : frame.delta.state;
            return state._tag === 'Read' ? Queue.offer(rows, state.view.rows) : Effect.void;
          }),
        );
        const view = yield* Queue.take(rows);
        const titled = (kind: string) => view.filter((row) => row.kind === kind).map((row) => row.title);
        expect(titled('renderer').toSorted()).toEqual(['App — Notes', 'MCP view — linear', 'Page — example.com']);
        expect(titled('graphics')).toEqual(['Graphics']);
        expect(titled('interface')).toEqual(['Interface']);
        expect(view.find((row) => row.title.startsWith('Page'))?.close).toEqual([{ page, projectId: seeded.id }]);
        expect(view.find((row) => row.title.startsWith('App'))?.close).toBeUndefined();

        fake.sent({
          kind: 'declaration',
          seq: fake.next(),
          declaration: declaration(member(203, 'renderer', [{ _tag: 'AppView', project: seeded.id, app: 'notes', view: 'board' }])),
        });
        let replaced = yield* Queue.take(rows);
        while (replaced.some((row) => row.title.startsWith('Page'))) replaced = yield* Queue.take(rows);
        expect(replaced.filter((row) => row.kind === 'renderer').map((row) => row.title)).toEqual(['App — Notes']);

        fake.close();
        let ended = yield* Queue.take(rows);
        while (ended.some((row) => row.kind === 'renderer')) ended = yield* Queue.take(rows);
        expect(ended.map((row) => row.kind)).not.toContain('graphics');
      }),
  );
});
