import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { type AfterSubject, UNCHECKED } from './contract/wire/checks.js';
import type { ActChecks } from './contract/service/ruleChecks.js';
import { MINE, THEIRS } from '../composition/testing/checkoutFixture.js';
import { landingFixture, withLanding } from '../composition/testing/landingFixture.js';

const USER = "import { fresh } from './fresh.js';\nexport const user = fresh;\n";

layer(landingFixture(), { excludeTestServices: true })('landing gates', (it) => {
  it.effect(
    'a new upward crossing in the session’s own file refuses rule-violated, names the file, line and crossing, and commits nothing',
    () =>
      withLanding((gate) =>
        Effect.gen(function* () {
          const head = yield* gate.sh(['rev-parse', 'HEAD']);
          yield* gate.wrote(MINE, 'src/core/boot.ts', "import { main } from '../app/main';\nexport const boot = main;\n");
          const refusal = yield* gate.refused(MINE);
          expect(refusal.code).toBe('rule-violated');
          expect(refusal.reason).toMatch(
            /\|Import only downward\]\] · gate\n {4}fix: .+\n {4}src\/core\/boot\.ts:1 imports `\.\.\/app\/main`/u,
          );
          expect(refusal.unblock.join('\n')).toContain('"app order core/boot.ts -> app/"');
          expect(yield* gate.sh(['rev-parse', 'HEAD'])).toBe(head);
          expect((yield* gate.checked(MINE))?.violations.map(({ file, line, fingerprint }) => ({ file, line, fingerprint }))).toEqual([
            { file: 'src/core/boot.ts', line: 1, fingerprint: 'app order core/boot.ts -> app/' },
          ]);
        }),
      ),
  );

  it.effect(
    'a crossing in another writer’s lines of a selected file refuses naming its author, and lands with both once that writer fixes it',
    () =>
      withLanding((gate) =>
        Effect.gen(function* () {
          yield* gate.wrote(
            THEIRS,
            'src/core/shared.ts',
            "export const a = 1;\nimport { main } from '../app/main';\nexport const b = main;\nexport const c = 3;\n",
          );
          yield* gate.wrote(
            MINE,
            'src/core/shared.ts',
            "export const a = 1;\nimport { main } from '../app/main';\nexport const b = main + 1;\nexport const c = 3;\n",
          );
          const checked = yield* gate.checked(MINE);
          expect(checked?.refuses).toBe(true);
          expect(checked?.violations.map(({ file, line, holders }) => ({ file, line, holders }))).toEqual([
            { file: 'src/core/shared.ts', line: 2, holders: [THEIRS] },
          ]);
          const refused = yield* gate.refused(MINE);
          expect(refused.code).toBe('rule-violated');
          expect(refused.reason).toContain('src/core/shared.ts:2');
          expect(refused.reason).toContain(THEIRS);
          expect(refused.unblock.join('\n')).not.toMatch(/taking|wait for/u);
          yield* gate.wrote(
            THEIRS,
            'src/core/shared.ts',
            'export const a = 1;\nconst main = 0;\nexport const b = main + 1;\nexport const c = 3;\n',
          );
          const receipt = gate.landed(yield* gate.submit(MINE));
          expect(receipt.carried).toEqual([{ path: 'src/core/shared.ts', holders: [THEIRS] }]);
          expect(yield* gate.sh(['show', 'HEAD:src/core/shared.ts'])).toContain('const main = 0;');
        }),
      ),
  );

  it.effect('a file the judged tree marks linguist-generated is judged by no rule, so a crossing in it lands', () =>
    withLanding((gate) =>
      Effect.gen(function* () {
        yield* gate.wrote(MINE, '.gitattributes', 'src/core/built.ts linguist-generated=true\n');
        yield* gate.wrote(MINE, 'src/core/built.ts', "import { main } from '../app/main';\nexport const built = main;\n");
        const receipt = gate.landed(yield* gate.submit(MINE));
        expect(receipt.committed).toEqual(['.gitattributes', 'src/core/built.ts']);
      }),
    ),
  );

  it.effect('a file `paths` leaves out rides along when a selected file imports it, and the rules judge the tree with it', () =>
    withLanding((gate) =>
      Effect.gen(function* () {
        yield* gate.wrote(MINE, 'src/core/fresh.ts', 'export const fresh = 1;\n');
        yield* gate.wrote(MINE, 'src/core/user.ts', USER);
        expect((yield* gate.checked(MINE, { paths: ['src/core/user.ts'] }))?.refuses).toBe(false);
        const receipt = gate.landed(yield* gate.submit(MINE, { paths: ['src/core/user.ts'] }));
        expect(receipt.committed).toEqual(['src/core/fresh.ts', 'src/core/user.ts']);
      }),
    ),
  );

  it.effect('a path a pre-commit hook adds to what it commits is named by the receipt and handed to the rules judging after', () =>
    withLanding((gate) =>
      Effect.gen(function* () {
        yield* gate.wrote(MINE, 'src/core/extra.ts', 'export const extra = 2;\n');
        const handed: AfterSubject[] = [];
        const checks: ActChecks = { before: () => Effect.succeed(UNCHECKED), after: (one) => Effect.sync(() => void handed.push(one)) };
        const hook = join(gate.demo.demoRoot, '.git', 'hooks', 'pre-commit');
        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            writeFileSync(
              hook,
              '#!/bin/sh\nblob=$(printf "export const stamped = 1;\\n" | git hash-object -w --stdin) && git update-index --add --cacheinfo "100644,$blob,src/core/stamped.ts"\n',
            );
            chmodSync(hook, 0o755);
          }),
          () =>
            Effect.gen(function* () {
              const receipt = gate.landed(yield* gate.submit(MINE, { checks }));
              expect(receipt.committed).toEqual(['src/core/extra.ts', 'src/core/stamped.ts']);
              expect(handed.flatMap((one) => (one.kind === 'tree' ? one.paths : []))).toEqual(['src/core/extra.ts', 'src/core/stamped.ts']);
            }),
          () => Effect.sync(() => rmSync(hook, { force: true })),
        );
      }),
    ),
  );
});
