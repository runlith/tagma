import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { expect } from 'bun:test';
import { landingFixture, withLanding } from '../landingFixture.js';
import { MINE } from '../checkoutFixture.js';
import { LAYERED_KEY } from '../../../enforcement/testing/layered.js';
import { TRIGGERS } from '../../../graph/testing/triggers.js';

layer(landingFixture(), { excludeTestServices: true })('landing enforcement', (it) => {
  it.effect('a rule whose type is not named rule is enumerated, reached and judged through the law projection', () =>
    withLanding((gate) =>
      Effect.fnUntraced(function* () {
        yield* gate.enforced(MINE, { blockId: gate.rule, strictness: 'off' });
        yield* gate.demo.graph.blocks.create({
          projectId: gate.demo.projectId,
          tags: ['tag'],
          title: '#statute',
          fields: {
            id: 'statute',
            fields: { live: 'boolean', verdict: { type: 'schema', name: 'lawEnforcement' } },
            roles: { law: 'live', enforcement: 'verdict' },
          },
        });
        const statute = yield* gate.created(['statute'], 'Import only downward');
        const owner = yield* gate.created(['task'], 'Move the view off the panel');
        yield* gate.enforced(MINE, {
          blockId: statute,
          strictness: 'gate',
          inspection: LAYERED_KEY,
          on: TRIGGERS.landing,
          owners: { 'app order core/view.ts -> ui/': owner },
        });
        yield* gate.wrote(MINE, 'src/core/boot.ts', "import { main } from '../app/main';\nexport const boot = main;\n");
        const found = yield* gate.checked(MINE);
        expect(found?.violations.map((one) => [one.rule, one.fingerprint])).toEqual([[statute, 'app order core/boot.ts -> app/']]);
        expect((yield* gate.refused(MINE)).code).toBe('rule-violated');
      })(),
    ),
  );
});
