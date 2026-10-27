import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { holdingsAt } from '../../../landing/testing/doubles.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { TEST_CHECKOUT } from '../../../workspace/testing/doubles.js';
import { lineWrites } from '../../lineWrites.js';
import { checkoutFixture, withCheckout } from '../checkoutFixture.js';

const LEAD = 'team-lead';
const ACCOUNT = 'team-account';
const RETUNE = 'team-retune';
const UNFINISHED = 'team-unfinished';

layer(checkoutFixture, { excludeTestServices: true })('interleaved team work', (it) => {
  it.effect('submit_work lands a completed team and idle peer while adjacent unfinished additions remain held', () =>
    withCheckout((world) =>
      Effect.gen(function* () {
        const base = 'export const providers = [\n  "base",\n];\n';
        const prior = 'import { Effect } from "effect";\nexport const existing = () => Effect.gen(function* () {\n  return 1;\n});\n';
        yield* world.based({ 'providers.ts': base, 'effects.ts': prior });
        for (const threadId of [LEAD, ACCOUNT, RETUNE]) yield* world.namedAgent(threadId, { name: threadId, task: `${threadId} work` });
        yield* world.namedAgent(UNFINISHED, { name: UNFINISHED, task: 'unfinished work', running: true });
        const foreign = prior.replace('Effect.gen', 'Effect.fnUntraced');
        writeFileSync(join(world.root, 'effects.ts'), foreign);
        const ours = foreign.replace('  return 1;', '  yield* check();\n  return 1;');
        yield* world.written(LEAD, 'effects.ts', ours);
        expect(yield* world.submit(LEAD, { subject: 'one check beside a foreign migration' })).toMatchObject({
          status: 'landed',
          committed: ['effects.ts'],
          carried: [],
        });
        expect(yield* world.head('effects.ts')).toBe(prior.replace('  return 1;', '  yield* check();\n  return 1;'));
        expect(readFileSync(join(world.root, 'effects.ts'), 'utf8')).toBe(ours);

        const original = 'export const accounts = {\n  choose: () => "account",\n};\n';
        const coupled = original.replace('choose: () => "account"', 'choose: () => changed("account")');
        yield* world.written(ACCOUNT, 'hostedAccounts.stest.ts', original);
        yield* world.written(RETUNE, 'hostedAccounts.stest.ts', 'import { changed } from "./modelChanges";\n' + coupled);
        yield* world.written(RETUNE, 'modelChanges.ts', 'export const changed = (value: string) => value;\n');
        const cursor = base.replace('  "base",', '  "base",\n  "cursor",');
        yield* world.written(LEAD, 'providers.ts', cursor);
        const both = cursor.replace('  "cursor",', '  "cursor",\n  "opencode",');
        yield* world.written(UNFINISHED, 'providers.ts', both);
        const independent = 'export const independent = true;\n';
        yield* world.written(UNFINISHED, 'hostedAccounts.stest.ts', 'import { changed } from "./modelChanges";\n' + coupled + independent);
        yield* world.written(UNFINISHED, 'unfinished.ts', 'export const unfinished = true;\n');
        const dependent = yield* world.submit(RETUNE, { subject: 'account constructor contract' });
        expect(dependent).toMatchObject({
          status: 'landed',
          committed: ['hostedAccounts.stest.ts', 'modelChanges.ts'],
          carried: [{ path: 'hostedAccounts.stest.ts', holders: [ACCOUNT] }],
        });
        if (dependent.status !== 'landed') return;
        expect(
          yield* world.submit(LEAD, {
            subject: 'completed provider and accounts',
            taking: [ACCOUNT, RETUNE].map((threadId) => ({ threadId, label: threadId })),
          }),
        ).toMatchObject({ status: 'landed', committed: ['providers.ts'], carried: [] });
        expect(yield* world.head('providers.ts')).toBe(cursor);
        expect(yield* world.head('hostedAccounts.stest.ts')).toBe('import { changed } from "./modelChanges";\n' + coupled);
        const rows = yield* world.rows();
        for (const holder of [ACCOUNT, RETUNE])
          expect(
            rows
              .filter((row) => row.holder === holder && row.path.endsWith('hostedAccounts.stest.ts'))
              .map((row) => [row.state, row.commit]),
          ).toEqual([['committed', dependent.commit]]);
        expect(readFileSync(join(world.root, 'providers.ts'), 'utf8')).toBe(both);
        expect(readFileSync(join(world.root, 'hostedAccounts.stest.ts'), 'utf8')).toBe(
          'import { changed } from "./modelChanges";\n' + coupled + independent,
        );
        const rig = yield* holdingsAt(world.git, world.root, world.store, world.units, lineWrites);
        const judged = yield* rig.holdings.judged(RootId.make(TEST_CHECKOUT), [
          'providers.ts',
          'hostedAccounts.stest.ts',
          'modelChanges.ts',
          'unfinished.ts',
        ]);
        const unfinished = { kind: 'thread', thread: UNFINISHED };
        expect(judged.get('hostedAccounts.stest.ts')?.holding.verdict).toMatchObject({
          verdict: 'proven',
          hands: [{ holder: unfinished, added: 1, removed: 0 }],
        });
        expect(judged.get('providers.ts')?.holding.verdict).toMatchObject({
          verdict: 'proven',
          hands: [{ holder: unfinished, added: 1, removed: 0 }],
        });
        expect(judged.get('unfinished.ts')?.holding.verdict).toMatchObject({ verdict: 'proven', hands: [{ holder: unfinished }] });
      }),
    ),
  );
});
