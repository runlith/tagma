import { Data, Effect } from 'effect';
import type { WorkspacePackage } from './workspace.js';

export type Plan = {
  readonly tsc: readonly WorkspacePackage[];
  readonly svelte: readonly WorkspacePackage[];
};

export class WorkspaceMissing extends Data.TaggedError('WorkspaceMissing')<{
  readonly consumer: string;
  readonly dependency: string;
  readonly spec: string;
}> {
  override get message(): string {
    return (
      `${this.consumer} declares ${this.dependency} as "${this.spec}", but no workspace of that name ` +
      `exists. Nothing can resolve it, so ${this.consumer} cannot be checked as declared.`
    );
  }
}

export class ProjectConfigMissing extends Data.TaggedError('ProjectConfigMissing')<{
  readonly owner: string;
  readonly path: string;
}> {
  override get message(): string {
    return (
      `${this.owner} declares a typecheck script but has no ${this.path}. A declared check with no ` +
      `project configuration cannot run; give it one, or remove the script to leave it uncovered.`
    );
  }
}

export class ProjectConfigInvalid extends Data.TaggedError('ProjectConfigInvalid')<{
  readonly owner: string;
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.owner} declares a typecheck script but ${this.path} is not usable: ${this.reason}`;
  }
}

export type PlanFailure = WorkspaceMissing | ProjectConfigMissing | ProjectConfigInvalid;

export function closureOf(packages: readonly WorkspacePackage[], roots: readonly string[]): readonly WorkspacePackage[] {
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  const seen = new Set<string>();
  const walk = (name: string): void => {
    const entry = byName.get(name);
    if (entry === undefined || seen.has(name)) return;
    seen.add(name);
    for (const dep of entry.deps) walk(dep.name);
  };
  for (const root of roots) walk(root);
  return [...seen]
    .map((name) => byName.get(name))
    .filter((entry): entry is WorkspacePackage => entry !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export const plan = Effect.fn('projectGraph.plan')(function* (
  packages: readonly WorkspacePackage[],
  reached: readonly WorkspacePackage[],
): Effect.fn.Return<Plan, PlanFailure> {
  const names = new Set(packages.map((entry) => entry.name));

  for (const owner of reached) {
    for (const dep of owner.deps)
      if (dep.onWorkspace && !names.has(dep.name))
        return yield* new WorkspaceMissing({ consumer: owner.name, dependency: dep.name, spec: dep.spec });
    if (owner.kind === null) continue;
    if (owner.config.kind === 'absent') return yield* new ProjectConfigMissing({ owner: owner.name, path: owner.config.path });
    if (owner.config.kind === 'invalid')
      return yield* new ProjectConfigInvalid({
        owner: owner.name,
        path: owner.config.path,
        reason: owner.config.reason,
      });
  }

  return {
    tsc: reached.filter((entry) => entry.kind === 'tsc'),
    svelte: reached.filter((entry) => entry.kind === 'svelte'),
  };
});
