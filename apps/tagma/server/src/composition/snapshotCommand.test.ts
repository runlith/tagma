import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { resolve } from 'node:path';
import { capturedEffect } from './testing/captured.js';

const root = resolve('snapshot-command-unit');
const machine = resolve(root, 'machine.sqlite');

it.effect.each(['graphs/one.sqlite', '../other-installation.sqlite'])('offline migration refuses %s before touching storage', (selected) =>
  Effect.gen(function* () {
    for (const flags of [[], ['--without-snapshot', '--confirm']]) {
      const answer = yield* capturedEffect(['db', 'migrate', '--store', selected, ...flags], { TAGMA_DATABASE_PATH: machine }, root);
      expect(answer.code).toBe(2);
      expect(answer.err).toContain('machine-store-required');
      expect(answer.err).toContain(resolve(root, selected));
      expect(answer.err).toContain(machine);
    }
  }),
);
