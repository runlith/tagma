import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { join } from 'node:path';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import type { Git } from '@runlith/git/Git';
import { preparedBase } from '../../../change-record/testing/doubles.js';
import { expect } from 'bun:test';
import { FILE, MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('own lines are stored under the attributes the working tree gives their path', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        writeFileSync(join(world.root, 'src', '.gitattributes'), '*.ts text\n');
        const theirs = [FILE[0] as string, 'const two = 2; // theirs', ...FILE.slice(2)];
        yield* world.wrote(THEIRS, theirs);
        yield* world.wrote(MINE, [...theirs.slice(0, 4), 'const five = 5; // mine\r']);
        const answer = yield* world.submit(MINE);
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(answer.carried).toEqual([]);
        expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 5; // mine']);
      })(),
    ),
  );
  it.effect('where git normalizes line endings, a peer that rewrote an LF file in CRLF keeps its line and mine lands alone', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        writeFileSync(join(world.root, 'src', '.gitattributes'), '*.ts text=auto\n');
        const crlf = (lines: readonly string[]) => `${lines.join('\r\n')}\r\n`;
        const theirs = [FILE[0] as string, 'const two = 2; // theirs', ...FILE.slice(2)];
        writeFileSync(world.file, crlf(theirs));
        yield* world.record(THEIRS, `${FILE.join('\n')}\n`, crlf(theirs));
        const both = [...theirs.slice(0, 4), 'const five = 5; // mine'];
        writeFileSync(world.file, crlf(both));
        yield* world.record(MINE, crlf(theirs), crlf(both));
        const answer = yield* world.submit(MINE);
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(answer.carried).toEqual([]);
        expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 5; // mine']);
      })(),
    ),
  );
  it.effect('cancelling preparation releases its materialized texts and index without publishing them', () =>
    withCheckout((world) =>
      Effect.gen(function* () {
        const theirs = [FILE[0] as string, 'const two = 2; // theirs', ...FILE.slice(2)];
        yield* world.wrote(THEIRS, theirs);
        yield* world.wrote(MINE, [...theirs.slice(0, 4), 'const five = 5; // mine']);
        const head = yield* world.run(['rev-parse', 'HEAD']);
        const written = yield* Deferred.make<string>();
        const parked = yield* Deferred.make<void>();
        const git: Git['Service'] = {
          run: (args, options) =>
            args.includes('--stdin-paths')
              ? Effect.andThen(
                  Deferred.succeed(written, args[args.indexOf('-C') + 1]!),
                  Effect.andThen(Deferred.await(parked), world.git.run(args, options)),
                )
              : world.git.run(args, options),
        };
        const preparing = yield* Effect.forkScoped(world.builtAs(MINE, { git }));
        const mirror = yield* Deferred.await(written);
        expect(existsSync(mirror)).toBe(true);
        yield* Fiber.interrupt(preparing);
        expect(existsSync(mirror)).toBe(false);
        expect(readdirSync(preparedBase(world.store))).toEqual([]);
        expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(head);
      }),
    ),
  );
  it.effect('a file that is not UTF-8 text lands byte for byte as it stands', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const bytes = Buffer.concat([Buffer.from('export const word = "caf'), Buffer.from([0xe9]), Buffer.from('";\n')]);
        writeFileSync(join(world.root, 'src', 'latin.ts'), bytes);
        const answer = yield* world.submit(MINE, { paths: ['src/latin.ts'], whole: ['src/latin.ts'] });
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(answer.carried).toEqual([]);
        expect(yield* world.run(['rev-parse', 'HEAD:src/latin.ts'])).toBe(yield* world.run(['hash-object', 'src/latin.ts']));
      })(),
    ),
  );
});
