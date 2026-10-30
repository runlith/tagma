import { describe, expect } from 'bun:test';
import { dirname, join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem } from 'effect';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { autoTitle } from '../../../threads/contract/wire/settings.js';
import { turnsOf } from '../../../threads/testing/doubles.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { heard, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

describe('the CLI title call follows the one title condition', () => {
  layer(protocolWorld({ name: 'harness-untitled', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
    excludeTestServices: true,
  })('protocol world', (it) => {
    const launchedWith = Effect.fnUntraced(function* (label: string) {
      const { world, projectId, agent, birth } = yield* ProtocolWorld;
      const files = yield* FileSystem.FileSystem;
      const report = yield* agent(label);
      const command = join(dirname(report), WORLD_COMMAND);
      const argv = `${report}.argv`;
      const standing = yield* files.readFileString(command);
      yield* files.writeFileString(command, standing.replace('#!/bin/sh\n', `#!/bin/sh\nprintf '%s\\n' "$@" > '${argv}'\n`), {
        mode: 0o755,
      });
      const threadId = yield* birth();
      yield* turnsOf(world.runtime.owners).send(threadId, projectId, 'Answer the floor.');
      yield* until(
        Effect.map(heard(report), (lines) => (lines.some((line) => line.method === 'session/prompt') ? true : null)),
        'the turn reached the agent',
        report,
      );
      return (yield* files.readFileString(argv)).split('\n').filter((line) => line !== '');
    });

    it.effect('Claude Code is launched without its title call unless Tagma takes the title it writes', () =>
      Effect.gen(function* () {
        const { world, projectId } = yield* ProtocolWorld;
        const settings = Context.get(world.runtime.graph, Settings);
        expect(yield* launchedWith('titled')).not.toContain('--untitled');
        yield* settings.write({ scope: 'project', projectId, key: autoTitle.id, value: false });
        expect(yield* launchedWith('untitled')).toContain('--untitled');
      }),
    );
  });
});
