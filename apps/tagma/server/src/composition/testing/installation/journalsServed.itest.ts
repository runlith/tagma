import { afterAll, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Effect, Result } from 'effect';
import { readStepBack, writeStepBack } from '../../../installation/closure/attempt.js';
import { type Succession, SuccessorFailed } from '../../../installation/contract/service/succession.js';
import { INSTALL_FILE } from '../../../installation/contract/wire/layout.js';
import { swapCurrent } from '../../../platform/lock/versionedDirectories.js';
import type { ThreadRollouts } from '../../../threads/contract/service/rollouts.js';
import { journalsServed } from '../../returning.js';

const tree = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-journals-served-')));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const OLD = '20260101T000000000Z';
const NEW = '20260102T000000000Z';

it.live('a step back whose restart fails after the threads returned leaves them to return again at the next start', () =>
  Effect.gen(function* () {
    const installRoot = join(tree, 'install');
    for (const version of [OLD, NEW]) {
      mkdirSync(join(installRoot, version), { recursive: true });
      writeFileSync(join(installRoot, version, INSTALL_FILE), '{}');
    }
    swapCurrent(installRoot, NEW);
    writeStepBack(installRoot, { from: NEW, to: OLD, carried: false });
    const succession = {
      restart: () => Effect.fail(new SuccessorFailed({ detail: 'the installation before could not be started', log: '' })),
    } as unknown as Succession['Service'];
    const rollouts = {
      returnOnto: () => Effect.succeed({ threads: 0, kept: [], unreturned: [] }),
    } as unknown as ThreadRollouts['Service'];

    const handed = yield* journalsServed({
      installRoot,
      release: join(installRoot, NEW),
      handoff: Effect.succeed(succession),
      modules: [],
      rollouts,
      launch: undefined,
      notified: false,
    });

    expect(handed).toBeNull();
    expect(Result.getOrThrow(readStepBack(installRoot))?.journals?.returned).toBe(false);
  }),
);
