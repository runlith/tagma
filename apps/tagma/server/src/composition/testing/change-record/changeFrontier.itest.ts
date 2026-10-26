import { layer } from '@runlith/effect-test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'bun:test';
import {} from '@runlith/effect-test';
import { Effect } from 'effect';
import { ConnectionError, SqlError } from 'effect/sql/SqlError';
import type { MachineUnits } from '../../../platform/contract/service/units.js';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { recordOver } from '../landingServices.js';
import { recordWrite } from '../../../change-record/testing/doubles.js';
import { testPlace } from '../../../workspace/testing/doubles.js';
import { call, FILE, MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
type Checkout = Effect.Success<ReturnType<typeof makeCheckout>>;
const toolsFor = Effect.fnUntraced(function* (w: Checkout, threadId: string, units: MachineUnits['Service'] = w.units) {
  return createTools({
    cwd: w.root,
    world: makeMachineWorld(() => null),
    commandTimes: unruledTimes,
    searchMs: LONGEST_ACT_MS,
    changes: (yield* recordOver(w.store, units)).changes({ work: { projectId: w.projectId, threadId } }),
  });
});
const handCommit = (w: Checkout, message: string) =>
  w.run(['-c', 'user.name=h', '-c', 'user.email=h@h', 'commit', '-q', '-m', message, '--', 'src/a.ts']);
const textOf = (lines: readonly string[]): string => `${lines.join('\n')}\n`;
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('a stale prefix neither blocks a fresh provable write nor holds its session', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const w = checkout;
        const peer = yield* toolsFor(w, THEIRS);
        const mine = yield* toolsFor(w, MINE);
        yield* call(peer.edit, { path: 'src/a.ts', oldString: FILE[0] as string, newString: 'const one = 100;' });
        const movedOn = [FILE[0] as string, 'const two = 222;', ...FILE.slice(2)];
        writeFileSync(join(w.root, 'src/a.ts'), textOf(movedOn));
        yield* handCommit(w, 'the branch moved without the peer line');
        yield* call(mine.edit, { path: 'src/a.ts', oldString: 'const two = 222;', newString: 'const two = 223;' });
        const receipt = yield* w.submit(MINE);
        expect(receipt.status).toBe('landed');
        expect(yield* w.committed()).toContain('const two = 223;');
        expect((yield* w.rows()).find((row) => row.holder === MINE)?.committedAt).not.toBeNull();
      }),
    ),
  );
  it.effect('a net-zero typed chain holds no path and settles empty', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const w = checkout;
        const mine = yield* toolsFor(w, MINE);
        yield* call(mine.edit, { path: 'src/a.ts', oldString: FILE[0] as string, newString: 'const one = 100;' });
        yield* call(mine.edit, { path: 'src/a.ts', oldString: 'const one = 100;', newString: FILE[0] as string });
        const head = yield* w.run(['rev-parse', 'HEAD']);
        expect(yield* w.submit(MINE)).toEqual({ status: 'nothing' });
        expect(yield* w.run(['rev-parse', 'HEAD'])).toBe(head);
      }),
    ),
  );
  it.effect('a write that overwrites a neighbour uncommitted line lands it alone, the neighbour line overwritten', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const w = checkout;
        const peer = yield* toolsFor(w, THEIRS);
        yield* call(peer.edit, { path: 'src/a.ts', oldString: FILE[0] as string, newString: 'const one = 100;' });
        const base = readFileSync(join(w.root, 'src/a.ts'), 'utf8');
        const over = base.replace('const one = 100;', 'const one = 101;');
        yield* recordWrite(w.units, w.store, w.projectId, MINE, testPlace('src/a.ts'), {
          before: base,
          after: over,
          mode: '100644',
        });
        writeFileSync(join(w.root, 'src/a.ts'), over);
        const receipt = yield* w.submit(MINE);
        expect(receipt).toMatchObject({
          status: 'landed',
          commit: yield* w.run(['rev-parse', 'HEAD']),
          committed: ['src/a.ts'],
          carried: [],
        });
        expect(yield* w.committed()).toContain('const one = 101;');
      }),
    ),
  );
  it.effect('a path this session holds lands its own lines and leaves bytes no row explains on disk', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const w = checkout;
        const made = ['const one = 100;', ...FILE.slice(1)];
        yield* w.wrote(MINE, made);
        const working = `${textOf(made)}const rowless = 1;\n`;
        writeFileSync(join(w.root, 'src/a.ts'), working);
        const receipt = yield* w.submit(MINE);
        expect(receipt.status).toBe('landed');
        expect(yield* w.committed()).toEqual(made);
        expect(readFileSync(join(w.root, 'src/a.ts'), 'utf8')).toBe(working);
      }),
    ),
  );
  it.effect('a write the record store cannot take is refused and leaves the file as it stood', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const w = checkout;
        const mine = yield* toolsFor(w, MINE);
        const first = textOf(['const one = 1;', ...FILE.slice(1)]);
        const second = textOf(['const one = 2;', ...FILE.slice(1)]);
        yield* call(mine.write, { path: join(w.root, 'src/a.ts'), content: first });
        const down: MachineUnits['Service'] = {
          read: (work, options) => w.units.read(work, options),
          markReadOnly: (work) => w.units.markReadOnly(work),
          markWrite: (work) => w.units.markWrite(work),
          write: () => Effect.fail(new SqlError({ reason: new ConnectionError({ cause: new Error('the store is down') }) })),
        };
        const refusing = yield* toolsFor(w, MINE, down);
        expect(yield* call(refusing.write, { path: join(w.root, 'src/a.ts'), content: second })).toContain('Nothing was written');
        expect(readFileSync(join(w.root, 'src/a.ts'), 'utf8')).toBe(first);
        expect(yield* w.rows()).toHaveLength(1);
      }),
    ),
  );
});
