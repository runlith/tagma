import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { TerminalFixture, terminalFixture } from '../composition/testing/fixture.js';

layer(terminalFixture, { excludeTestServices: true })('reply', (it) => {
  it.effect('unknown and absent questions remain refusals on an idle thread', () =>
    Effect.gen(function* () {
      const world = yield* TerminalFixture;
      const checkout = yield* world.checkout();
      const born = yield* world.tagma(['threads', 'new', '--title', 'idle', '--project', checkout.name], { cwd: checkout.root });
      expect(born.code).toBe(0);
      const threadId = born.out.trim();
      const unknown = yield* world.tagma(['reply', threadId, 'answer', '--question', 'not-a-question'], { cwd: checkout.root });
      expect(unknown.code).toBe(2);
      expect(unknown.err).toContain('refused[not-found]');
      expect(unknown.err).toContain('not-a-question');
      expect(unknown.err).toContain('unblock:');
      const absent = yield* world.tagma(['reply', threadId, 'answer'], { cwd: checkout.root });
      expect(absent.code).toBe(2);
      expect(absent.err).toContain('refused[no-question]');
      expect(absent.err).toContain('unblock:');
    }),
  );
});
