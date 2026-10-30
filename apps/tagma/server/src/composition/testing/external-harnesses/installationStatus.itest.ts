import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { makeDoorWorld } from '../doorFixture.js';
import { doctrine } from '../../doctrine.js';
import { installSkill } from '../../../external-harnesses/installs/skillInstall.js';

it.live('the installation status door reads a user skill still installed at its declared vendor alias', () =>
  Effect.gen(function* () {
    const world = yield* makeDoorWorld({ own: 'reads a previous user skill location under its configured harness home' });
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'legacy-skill-' });
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const kept = process.env.CLAUDE_CONFIG_DIR;
        process.env.CLAUDE_CONFIG_DIR = home;
        return kept;
      }),
      (kept) =>
        Effect.sync(() => {
          if (kept === undefined) delete process.env.CLAUDE_CONFIG_DIR;
          else process.env.CLAUDE_CONFIG_DIR = kept;
        }),
    );
    const target = join(home, 'skills', 'tagma');
    const { contributed } = yield* doctrine;
    yield* installSkill(target, contributed);
    const projectId = yield* world.stealthProject();
    expect(yield* world.op('read_installation_status', {}, `project=${projectId}`)).toMatchObject({
      status: 200,
      body: { skill: expect.arrayContaining([{ state: 'current', target }]) },
    });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
