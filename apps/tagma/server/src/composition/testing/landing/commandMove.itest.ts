import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { call, MINE } from '../checkoutFixture.js';
import { base, commandLayer, commandWorld } from '../change-record/commandWorld.js';

layer(commandLayer, { excludeTestServices: true })('submitted moves', (it) => {
  it.effect('a git mv and an edit in one command land as one move when paths names only the destination', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* call(s.mine.bash, {
        command: `mkdir -p lib && git mv src/a.ts lib/a.ts && printf 'const six = 6;\\n' >> lib/a.ts`,
        description: 'Move and extend a file',
      });
      yield* s.decided(MINE);

      const landed = yield* s.w.submit(MINE, { commands: s.commands, paths: ['lib/a.ts'] });
      expect(landed).toMatchObject({ status: 'landed', committed: ['lib/a.ts', 'src/a.ts'] });
      expect(yield* s.w.run(['status', '--porcelain'])).toBe('');
      expect(yield* s.w.run(['show', 'HEAD:lib/a.ts'])).toBe(`${base}const six = 6;`);
    }),
  );
});
