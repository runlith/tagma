import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import {} from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { recordOver } from '../landingServices.js';
import { testWalks } from '../../../change-record/testing/walks.js';
import { collectReleased, sweepVersions } from '../../../change-record/record/versions.js';
import { workspaceChangeContent } from '../../../change-record/store/tables.js';
import { idleCommands } from '../../../change-record/testing/doubles.js';
import { FILE, MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
const base = `${FILE.join('\n')}\n`;
const landed = ['const one = 10;', ...FILE.slice(1)];
const peered = ['const one = 10;', 'const two = 20;', ...FILE.slice(2)];
const text = (lines: readonly string[]) => `${lines.join('\n')}\n`;
const stand = Effect.fnUntraced(function* (w: Effect.Success<ReturnType<typeof makeCheckout>>) {
  for (const id of [MINE, THEIRS]) yield* w.namedAgent(id, { name: id, task: 'owned lines' });
  const record = yield* recordOver(w.store, w.units, yield* idleCommands(), testWalks);
  const kept = (...texts: readonly string[]) =>
    Effect.map(record.versions(texts.map(contentDigest)), (found) => texts.filter((one) => found.has(contentDigest(one))));
  return { w, kept };
});
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('a landing releases the versions only its rows named, and collecting them keeps every version a held row names', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.w.wrote(MINE, landed);
        expect((yield* s.w.submit(MINE)).status).toBe('landed');
        yield* s.w.wrote(THEIRS, peered);
        yield* collectReleased(s.w.units, s.w.store);
        expect(yield* s.kept(base, text(landed), text(peered))).toEqual([text(landed), text(peered)]);
      }),
    ),
  );
  it.effect('a sweep collects every kept version no held row names, the backlog no transition released among them', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        const backlog = 'a version kept before anything released it\n';
        yield* s.w.wrote(MINE, landed);
        yield* s.w.store.db
          .insert(workspaceChangeContent)
          .values({ digest: contentDigest(backlog), text: backlog, bytes: backlog.length, at: new Date(yield* Clock.currentTimeMillis) });
        yield* collectReleased(s.w.units, s.w.store);
        yield* sweepVersions(s.w.units, s.w.store);
        expect(yield* s.kept(base, text(landed), backlog)).toEqual([base, text(landed)]);
      }),
    ),
  );
});
