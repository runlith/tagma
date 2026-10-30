import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { ProjectPolicy } from '../../graph/contract/service/serving.js';
import { ServedTree } from '../../graph/contract/service/serving.js';
import { hookLedger } from './hookLedger.js';
import { hooksStatus, skillStatus } from './status.js';
import { skillLinks, skillTarget, userSkillTarget } from './targets.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { Doctrine, doctrineOf, type SectionCatalog } from '../../platform/contract/service/sections.js';
import { INSTALL_STATUS_OPERATIONS } from '../contract/wire/installs.js';

const installations = Effect.fnUntraced(function* (privateProject: boolean, rootPath: string, contributed: SectionCatalog) {
  const [project, canonical] = yield* Effect.all(
    [skillStatus(skillTarget(rootPath), contributed), skillStatus(userSkillTarget(), contributed)],
    { concurrency: 'unbounded' },
  );
  let user = canonical;
  if (user.state === 'missing') {
    for (const target of yield* skillLinks(null)) {
      const alias = yield* skillStatus(target, contributed);
      if (alias.state === 'missing') continue;
      user = alias;
      break;
    }
  }
  const [own, rest] = privateProject ? [user, project] : [project, user];
  return [own, ...(rest.state === 'missing' ? [] : [rest])];
});

export const installationStatusRead = pair(
  INSTALL_STATUS_OPERATIONS.read_installation_status,
  body(INSTALL_STATUS_OPERATIONS.read_installation_status, {
    execute: Effect.fnUntraced(function* (_input, _prepared) {
      const call = yield* yield* CurrentProject;
      const registered = yield* (yield* Projects).byId(call.project.id);
      const project = (yield* (yield* ProjectPolicy).read([registered.id])).get(registered.id);
      if (project === undefined)
        return yield* new GateRefusal('not-found', `project ${registered.id} is not in this store's registry`, [
          'read the project registry again',
        ]);
      const served = yield* ServedTree;
      const conflicts =
        served === null
          ? []
          : yield* Effect.mapError(
              served.conflicts(),
              (failure) => new GateRefusal('conflicts-unreadable', failure.message, ['read the tree again once git answers']),
            );
      const contributed = doctrineOf(yield* Doctrine).contributed;
      return {
        status: 'ok' as const,
        conflicts: conflicts.map((conflict) => conflict.path),
        skill: yield* installations(project.private, project.rootPath, contributed),
        hooks: project.private ? null : yield* hooksStatus(project.rootPath),
        hookLedger: project.private ? null : yield* hookLedger(project.rootPath),
      };
    }, Effect.provide(BunFileSystem.layer)),
  }),
);
