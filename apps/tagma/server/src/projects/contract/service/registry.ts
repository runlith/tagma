import { Context, type Effect } from 'effect';
import type { GitAnswerInvalid, GitRefused, GitUnreadable } from '@runlith/git/repository';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { GateRefusal, GitRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ProjectIdentity, ProjectPlace, ProjectRefusal, ProjectRow, Registered } from '../wire/project.js';

export class ProjectIdentification extends Context.Service<
  ProjectIdentification,
  {
    identify(path: string): Effect.Effect<ProjectIdentity, GitUnreadable | GitRefused | GitAnswerInvalid>;
  }
>()('tagma/projects/ProjectIdentification') {}

export class Projects extends Context.Service<
  Projects,
  {
    list(): Effect.Effect<ProjectRow[], StoreFailure>;
    byId(id: number): Effect.Effect<ProjectRow, StoreFailure | GateRefusal<'not-found'>>;
    named(ref: string): Effect.Effect<ProjectRow, StoreFailure | GateRefusal<ProjectRefusal>>;
    resolve(
      ref: string | undefined,
      here?: ProjectPlace,
    ): Effect.Effect<ProjectRow | undefined, StoreFailure | GateRefusal<ProjectRefusal | GitRefusal>>;
    global(): Effect.Effect<ProjectRow | undefined, StoreFailure>;
    removed(): Effect.Effect<readonly number[], StoreFailure>;
    register(
      unit: WriteUnit<'machine'>,
      input: { readonly name: string; readonly identity: ProjectIdentity },
    ): Effect.Effect<
      Registered,
      StoreFailure | GateRefusal<GitRefusal | 'unwritable-root' | 'reserved-project' | 'project-name' | 'duplicate-name' | 'duplicate-root'>
    >;
    setRoot(
      unit: WriteUnit<'machine'>,
      row: ProjectRow,
      identity: ProjectIdentity,
    ): Effect.Effect<ProjectRow, StoreFailure | GateRefusal<GitRefusal | 'unwritable-root' | 'global-permanent' | 'duplicate-root'>>;
    remove(unit: WriteUnit<'machine'>, project: ProjectRow): Effect.Effect<void, StoreFailure | GateRefusal<'global-permanent'>>;
    forget(unit: WriteUnit<'machine'>, project: ProjectRow): Effect.Effect<void, StoreFailure>;
    readonly registryVersion: Effect.Effect<number>;
  }
>()('tagma/projects/Projects') {}
