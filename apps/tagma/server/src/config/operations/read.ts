import { Effect } from 'effect';
import { Git } from '@runlith/git/Git';
import { commitOf } from '@runlith/git/repository';
import { assembled, shows } from '@tagma/inspection/builtins';
import type { ModuleMap } from '@tagma/inspection/rule';
import { body, pair } from '../../platform/contract/service/body.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { actingGit, type OwnGitFailed, readingFailed } from '../../platform/git/ownGit.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { actorRefOf } from '../../platform/contract/wire/actor.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { terminalActorOfRef } from '../../executions/terminals/principals.js';
import { Configs } from '../contract/service/configs.js';
import type { Config, Descriptor } from '../contract/wire/config.js';
import { CONFIG_OPERATIONS, type ConfigReading, type ConfiguredInspection } from '../contract/wire/operations.js';

const UNMAPPED: ModuleMap = { modules: [], relations: [], region: [] };

const inspectionOf = (key: string, descriptor: Descriptor): ConfiguredInspection => {
  if ('builtin' in descriptor) return { key, inspection: descriptor.builtin, concern: shows(assembled(descriptor, UNMAPPED)).concern };
  if ('program' in descriptor) return { key, inspection: `${descriptor.program} ${descriptor.name}`, concern: descriptor.concern };
  const { linter } = descriptor;
  return { key, inspection: 'rule' in descriptor ? `${linter.tool} ${descriptor.rule}` : linter.tool, concern: null };
};

const readingOf = (config: Config): ConfigReading => ({
  inspections: [...config.inspections].map(([key, descriptor]) => inspectionOf(key, descriptor)),
  format: config.format.map(({ key, command }) => ({ key, run: command.run, files: command.files })),
});

const actorOf = (caller: Caller): TerminalActor => {
  const ref = actorRefOf(caller.actor);
  return ref === null ? { _tag: 'Operator' } : terminalActorOfRef(ref);
};

const gitRefusal = (failure: OwnGitFailed): GateRefusal<'git-refused' | 'git-unreadable'> =>
  new GateRefusal(failure.ran ? 'git-refused' : 'git-unreadable', `${failure.op}: ${failure.message}`, [
    'read what git said above and clear it, then read the config again',
  ]);

export const CONFIG_PAIRS = {
  read_config: pair(
    CONFIG_OPERATIONS.read_config,
    body(CONFIG_OPERATIONS.read_config, {
      execute: Effect.fnUntraced(
        function* (_input, _prepared: undefined, caller: Caller) {
          const call = yield* yield* CurrentProject;
          const root = (yield* (yield* Projects).byId(call.project.id)).rootPath;
          const git = yield* Git;
          const head = yield* commitOf(actingGit(git, 'config-head'), root, 'HEAD').pipe(
            Effect.mapError((failure) => readingFailed('config-head', failure)),
          );
          if (head === null) return { status: 'ok' as const, config: null };
          const config = yield* (yield* Configs).read({ projectId: call.project.id, actor: actorOf(caller), root, tree: head });
          return { status: 'ok' as const, config: config === null ? null : readingOf(config) };
        },
        Effect.catchTag('OwnGitFailed', (failure) => Effect.fail(gitRefusal(failure))),
      ),
    }),
  ),
};
