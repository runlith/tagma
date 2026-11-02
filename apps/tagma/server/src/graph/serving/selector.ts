import { Effect } from 'effect';
import { Projects } from '../../projects/contract/service/registry.js';
import type { ProjectRefusal, ProjectRow } from '../../projects/contract/wire/project.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { SourceProject, type SourceRefusal } from '../contract/service/source.js';

export type SelectorRefusal = ProjectRefusal | SourceRefusal | 'global-missing' | 'no-home';

export const resolveProject = Effect.fn('graph.resolveProject')(function* (
  selector: string | number,
): Effect.fn.Return<ProjectRow, GateRefusal<SelectorRefusal> | StoreFailure, Projects | SourceProject> {
  const projects = yield* Projects;
  if (typeof selector === 'number' || /^\d+$/u.test(selector)) return yield* projects.byId(Number(selector));
  if (selector !== 'global' && selector !== 'tagma') return yield* projects.named(selector);
  const alias = selector === 'global' ? yield* projects.global() : yield* (yield* SourceProject).project();
  if (alias === undefined) {
    return yield* new GateRefusal(
      selector === 'global' ? 'global-missing' : 'no-home',
      selector === 'global' ? 'the server has no GLOBAL graph' : 'no registered project covers the running server’s own source',
      [
        selector === 'global'
          ? 'the server must ensure its permanent GLOBAL project before an agent opens'
          : 'register the checkout the server runs from as a project',
      ],
    );
  }
  const named = (yield* projects.list()).filter((project) => project.name === selector && project.id !== alias.id);
  if (named.length > 0) {
    const candidates = [...named, alias];
    return yield* new GateRefusal('ambiguous-project', `"${selector}" names an alias and a registered project`, [
      'use a registered project id instead of the ambiguous alias',
      ...candidates.map((project) => `use project id ${project.id} for ${project.name}`),
    ]);
  }
  return alias;
});
