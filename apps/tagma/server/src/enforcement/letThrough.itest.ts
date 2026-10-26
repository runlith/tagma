import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { MINE } from '../composition/testing/checkoutFixture.js';
import { landingFixture, withLanding } from '../composition/testing/landingFixture.js';
import { CallAuthority } from '../platform/contract/service/authority.js';

layer(landingFixture(), { excludeTestServices: true })('allowed landings', (it) => {
  it.effect('a second import along a debt crossing in the indebted file lands, and so does a changed file the builtin does not read', () =>
    withLanding((gate) =>
      Effect.gen(function* () {
        yield* gate.wrote(
          MINE,
          'src/core/view.ts',
          "import { panel } from '../ui/panel';\nexport const view = panel;\nimport '../ui/panel.js';\n",
        );
        yield* gate.wrote(MINE, 'src/data.json', '{ "core": "../app/main" }\n');
        const receipt = gate.landed(yield* gate.submit(MINE));
        expect(receipt.committed).toEqual(['src/core/view.ts', 'src/data.json']);
        expect(receipt.watched).toBeUndefined();
      }),
    ),
  );

  it.effect(
    'a crossing the base already holds lands where it stays or follows a renamed target; a file renamed with it is new, and an escape excuses nothing else',
    () =>
      withLanding((gate) =>
        Effect.gen(function* () {
          yield* gate.put('src/core/late.ts', "import { main } from '../app/main';\nexport const late = main;\n");
          yield* gate.committed('a crossing that got in outside Tagma');
          yield* gate.wrote(
            MINE,
            'src/core/late.ts',
            "import { main } from '../app/main';\nexport const late = main;\nexport const again = late;\n",
          );
          gate.landed(yield* gate.submit(MINE));
          yield* gate.wrote(MINE, 'src/app/main.ts', null);
          yield* gate.wrote(MINE, 'src/app/entry.ts', "import { panel } from '../ui/panel';\nexport const main = panel;\n");
          yield* gate.wrote(MINE, 'src/core/late.ts', "import { main } from '../app/entry';\nexport const late = main;\n");
          gate.landed(yield* gate.submit(MINE));
          yield* gate.wrote(MINE, 'src/core/late.ts', null);
          yield* gate.wrote(MINE, 'src/core/later.ts', "import { main } from '../app/entry';\nexport const later = main;\n");
          expect((yield* gate.refused(MINE)).code).toBe('rule-violated');
        }),
      ),
  );

  it.effect(
    'a gated crossing refuses rule-violated under every approval mode and commits nothing; the rule re-enforced at watch in the graph lets the very next landing in and names it in watched',
    () =>
      withLanding((gate) =>
        Effect.gen(function* () {
          yield* gate.wrote(MINE, 'src/core/boot.ts', "import { main } from '../app/main';\nexport const boot = main;\n");
          const head = yield* gate.sh(['rev-parse', 'HEAD']);
          for (const mode of ['review', 'trust', 'bypass'] as const) {
            const refusal = yield* gate.landing(MINE).pipe(Effect.provideService(CallAuthority, mode), Effect.flip);
            expect([mode, 'code' in refusal ? refusal.code : null]).toEqual([mode, 'rule-violated']);
          }
          expect(yield* gate.sh(['rev-parse', 'HEAD'])).toBe(head);
          yield* gate.enforcedAt('watch');
          expect(gate.landed(yield* gate.submit(MINE)).watched).toEqual([
            {
              rule: gate.rule,
              title: expect.any(String),
              strictness: 'watch',
              fingerprint: 'app order core/boot.ts -> app/',
              file: 'src/core/boot.ts',
              line: 1,
              specifier: '../app/main',
              message: expect.any(String),
              fix: expect.any(String),
              generalFix: expect.any(String),
            },
          ]);
        }),
      ),
  );
});
