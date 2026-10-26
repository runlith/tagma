import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect } from 'effect';
import type { CommitLanded } from '../../../landing/contract/service/commitLandings.js';
import { MINE } from '../checkoutFixture.js';
import { landingFixture, withLanding } from '../landingFixture.js';

layer(landingFixture(), { excludeTestServices: true })('commit landings', (it) => {
  it.effect('a landed commit is published once, to the thread whose session landed it', () =>
    withLanding((gate) =>
      Effect.fnUntraced(function* () {
        const heard: CommitLanded[] = [];
        const leave = gate.commitLandings.subscribe((event) => Effect.sync(() => void heard.push(event)));
        yield* gate.wrote(MINE, 'src/core/extra.ts', 'export const extra = 1;\n');
        const landed = gate.landed(yield* gate.submit(MINE));
        leave();
        expect(heard).toEqual([{ threadId: MINE, projectId: gate.demo.projectId, commit: landed.commit, subject: landed.subject ?? '' }]);
      })(),
    ),
  );
});
