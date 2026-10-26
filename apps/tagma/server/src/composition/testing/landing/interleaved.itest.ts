import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { join } from 'node:path';
import { Holdings } from '../../../change-record/contract/service/holdings.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { nativeLanding } from './native.js';

it.live(
  'native submit_work lands a completed team and idle peer while adjacent unfinished additions remain held',
  () =>
    Effect.gen(function* () {
      const base = 'export const providers = [\n  "base",\n];\n';
      const prior = 'import { Effect } from "effect";\nexport const existing = () => Effect.gen(function* () {\n  return 1;\n});\n';
      const { world, files, root, projectId, doors, born, write, read } = yield* nativeLanding({
        'providers.ts': base,
        'effects.ts': prior,
      });
      const lead = yield* born();
      const account = yield* born();
      const retune = yield* born();
      const unfinished = yield* born();
      yield* Context.get(world.runtime.graph, MachineStore)
        .db.update(threadRecord())
        .set({ status: 'running' })
        .where(eq(threadRecord().id, unfinished.threadId));
      const foreign = prior.replace('Effect.gen', 'Effect.fnUntraced');
      yield* files.writeFileString(join(root, 'effects.ts'), foreign);
      const ours = foreign.replace('  return 1;', '  yield* check();\n  return 1;');
      yield* write(lead.threadId, 'effects.ts', ours);
      expect(yield* doors.atNative('submit_work', { subject: 'one check beside a foreign migration' }, lead)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['effects.ts'], carried: [] } },
      });
      expect(yield* read('effects.ts')).toBe(prior.replace('  return 1;', '  yield* check();\n  return 1;'));
      expect(yield* files.readFileString(join(root, 'effects.ts'))).toBe(ours);
      const original = 'export const accounts = {\n  choose: () => "account",\n};\n';
      const coupled = original.replace('choose: () => "account"', 'choose: () => changed("account")');
      yield* write(account.threadId, 'hostedAccounts.stest.ts', original);
      yield* write(retune.threadId, 'hostedAccounts.stest.ts', 'import { changed } from "./modelChanges";\n' + coupled);
      yield* write(retune.threadId, 'modelChanges.ts', 'export const changed = (value: string) => value;\n');
      const cursor = base.replace('  "base",', '  "base",\n  "cursor",');
      yield* write(lead.threadId, 'providers.ts', cursor);
      const both = cursor.replace('  "cursor",', '  "cursor",\n  "opencode",');
      yield* write(unfinished.threadId, 'providers.ts', both);
      const independent = 'export const independent = true;\n';
      yield* write(unfinished.threadId, 'hostedAccounts.stest.ts', 'import { changed } from "./modelChanges";\n' + coupled + independent);
      yield* write(unfinished.threadId, 'unfinished.ts', 'export const unfinished = true;\n');
      const dependent = yield* doors.atNative('submit_work', { subject: 'account constructor contract' }, retune);
      expect(dependent).toMatchObject({
        class: 'answer',
        value: {
          submitted: {
            status: 'landed',
            committed: ['hostedAccounts.stest.ts', 'modelChanges.ts'],
            carried: [{ path: 'hostedAccounts.stest.ts', holders: [account.threadId] }],
          },
        },
      });
      const answer = yield* doors.atNative(
        'submit_work',
        {
          subject: 'completed provider and accounts',
          taking: [account.threadId, retune.threadId],
        },
        lead,
      );
      expect(answer).toMatchObject({
        class: 'answer',
        value: {
          submitted: {
            status: 'landed',
            committed: ['providers.ts'],
            carried: [],
          },
        },
      });
      expect(yield* read('providers.ts')).toBe(cursor);
      expect(yield* read('hostedAccounts.stest.ts')).toBe('import { changed } from "./modelChanges";\n' + coupled);
      for (const by of [account, retune]) {
        const history = yield* world.op('read_changes', { agent: by.threadId, limit: 10 }, `project=${projectId}`);
        expect(history.body).toMatchObject({
          turns: expect.arrayContaining([expect.objectContaining({ path: 'hostedAccounts.stest.ts', state: 'committed' })]),
          commits: expect.arrayContaining([expect.objectContaining({ subject: 'account constructor contract' })]),
        });
      }
      expect(yield* files.readFileString(join(root, 'providers.ts'))).toBe(both);
      const placed = yield* Context.get(world.runtime.workspace, CheckoutPaths).placeAcross(root);
      if (placed === null) return yield* Effect.die('the checkout was not registered');
      const holdings = Context.get(world.runtime.owners, Holdings);
      const judged = yield* holdings.judged(RootId.make(placed.checkout), [
        'providers.ts',
        'hostedAccounts.stest.ts',
        'modelChanges.ts',
        'unfinished.ts',
      ]);
      expect(judged.get('hostedAccounts.stest.ts')?.holding.verdict).toMatchObject({
        verdict: 'proven',
        hands: [{ holder: { kind: 'thread', thread: unfinished.threadId }, added: 1, removed: 0 }],
      });
      expect(yield* files.readFileString(join(root, 'hostedAccounts.stest.ts'))).toBe(
        'import { changed } from "./modelChanges";\n' + coupled + independent,
      );
      expect(judged.get('providers.ts')?.holding.verdict).toMatchObject({
        verdict: 'proven',
        hands: [{ holder: { kind: 'thread', thread: unfinished.threadId }, added: 1, removed: 0 }],
      });
      expect(judged.get('unfinished.ts')?.holding.verdict).toMatchObject({
        verdict: 'proven',
        hands: [{ holder: { kind: 'thread', thread: unfinished.threadId } }],
      });
    }).pipe(Effect.provide(BunFileSystem.layer)),
  60_000,
);
