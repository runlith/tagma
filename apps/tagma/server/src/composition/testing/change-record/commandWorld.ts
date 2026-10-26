import { Clock, Context, Effect, Layer } from 'effect';
import { kind, shared } from '@runlith/testbed/worlds';
import { existsSync, watch } from 'node:fs';
import { dirname } from 'node:path';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { CheckoutFlights } from '@runlith/agent-tools/CheckoutFlights';
import { walkedSource } from '@runlith/agent-tools/testing/changeSource';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { changeRecordOf, commandRig } from '../../../change-record/testing/doubles.js';
import { Lives } from '../../../change-record/record/lives.js';
import { recordsOver } from '../../../thread-record/testing/records.js';
import { gitCheckoutPaths, testPlace } from '../../../workspace/testing/doubles.js';
import type { Walks } from '../../../change-record/lines/walks.js';
import { testWalks } from '../../../change-record/testing/walks.js';
import type { Patience } from '../../../change-record/record/commandRows.js';
import { FILE, MINE, THEIRS, makeCheckout, type CheckoutWorld } from '../checkoutFixture.js';

export const base = `${FILE.join('\n')}\n`;

export const fileReady = Effect.fn('testing.fileReady')((path: string, ready: () => boolean = () => existsSync(path)) =>
  Effect.acquireUseRelease(
    Effect.try({ try: () => watch(dirname(path)), catch: (cause) => cause }).pipe(Effect.orDie),
    (observer) =>
      Effect.callback<void>((resume) => {
        const changed = () => {
          try {
            if (ready()) resume(Effect.void);
          } catch (cause) {
            resume(Effect.die(cause));
          }
        };
        observer.on('change', changed);
        observer.on('error', (cause) => resume(Effect.die(cause)));
        changed();
      }),
    (observer) => Effect.sync(() => observer.close()),
  ),
);

export class CommandWalks extends Context.Service<CommandWalks, Walks>()('composition/CommandWalks') {}
class CommandCheckout extends Context.Service<CommandCheckout, CheckoutWorld>()('testing/CommandCheckout') {}
const checkouts = kind(CommandCheckout, (_params: {}, home) => makeCheckout(home));
export const commandWalksLayer = Layer.succeed(CommandWalks, testWalks);
export const commandLayer = Layer.merge(
  Layer.effectContext(Effect.map(shared(checkouts, {}), (world) => Context.add(world.context, CommandCheckout, world))),
  commandWalksLayer,
);

export const commandWorld = Effect.fnUntraced(function* (rows?: {
  readonly walks?: Walks;
  readonly patience?: Patience;
  readonly teams?: boolean;
  readonly cursor?: boolean;
}) {
  const walks = yield* CommandWalks;
  const clock = yield* Clock.Clock;
  const w = yield* CommandCheckout;
  yield* w.reset();
  for (const id of [MINE, THEIRS]) yield* w.namedAgent(id, { name: id, task: 'owned lines' });
  const paths = gitCheckoutPaths('repo-root', w.projectId);
  const { commands, intake } = yield* commandRig({
    store: w.store,
    units: w.units,
    git: w.git,
    walks: rows?.walks ?? walks,
    lives: new Lives(() => clock.currentTimeMillisUnsafe()),
    paths,
    patience: rows?.patience,
    ...(rows?.teams === true ? { records: yield* recordsOver(w.store, w.units) } : {}),
  });
  yield* Effect.addFinalizer(() => Effect.orDie(commands.settled({ projectId: w.projectId })));
  const record = yield* changeRecordOf(w.store, w.units, paths, intake, commands, walks);
  const world = makeMachineWorld(() => null);
  const tools = (threadId: string) =>
    createTools({
      cwd: w.root,
      world,
      commandTimes: unruledTimes,
      searchMs: LONGEST_ACT_MS,
      unowned: ['.tagma'],
      changes: record.changes({ work: { projectId: w.projectId, threadId } }),
      flights: rows?.cursor === true ? new CheckoutFlights(walkedSource().source) : undefined,
    });
  const decided = (threadId: string) => commands.decided({ projectId: w.projectId, threadId });
  const held = (path: string) =>
    Effect.map(record.held({ kind: 'path', projectId: w.projectId, place: testPlace(path) }), (rows) =>
      rows.map((row) => [row.threadId, row.beforeHash, row.afterHash] as const),
    );
  return { w, commands, intake, record, mine: tools(MINE), theirs: tools(THEIRS), decided, held };
});
