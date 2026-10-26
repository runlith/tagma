import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { Router } from '@runlith/layer/Router';
import { SETTABLE_SCOPES, type SettableScope } from '@tagma/server/platform/contract/wire/setting';
import { settingsHref } from '$lib/features/workspace/address.js';
import type { SettingAnswer, SettingEntry } from '$lib/features/settings/SettingsCatalog.svelte.js';

export function scopeName(scope: SettableScope, project: Project | null): string {
  return scope === 'project' ? (project?.name ?? 'this project') : 'every project';
}

export function scopeTitle(scope: SettableScope, project: Project | null): string {
  return scope === 'project' ? (project?.name ?? 'This project') : 'Every project';
}

export type Scoped = { readonly scopes: readonly SettableScope[] };

export function landingScope(entry: Scoped): SettableScope {
  return entry.scopes.includes('project') ? 'project' : 'user';
}

export function sectionScopes(entries: readonly Scoped[]): readonly SettableScope[] {
  return SETTABLE_SCOPES.filter((scope) => entries.some((entry) => entry.scopes.includes(scope)));
}

export function sectionScope(entries: readonly Scoped[], wanted: SettableScope): SettableScope {
  const accepted = sectionScopes(entries);
  return accepted.length === 0 || accepted.includes(wanted) ? wanted : (accepted[0] as SettableScope);
}

const SCOPE_TAG: Record<SettableScope, string> = { project: 'Per project', user: 'Every project' };

export type ScopeLock = {
  readonly tag: string;
  readonly decided: string;
  readonly href: string;
  readonly label: string;
};

export function scopeLock(router: Router, entry: SettingEntry, scope: SettableScope, project: Project | null): ScopeLock | undefined {
  if (entry.scopes.includes(scope)) return undefined;
  const other = entry.scopes.find((accepted) => accepted !== scope);
  if (other === undefined) return undefined;
  const name = scopeName(other, project);
  return {
    tag: SCOPE_TAG[other],
    decided: other === 'user' ? `for ${name}` : 'in each project, separately',
    href: settingsHref(router, entry.section, other),
    label: `Edit for ${name}`,
  };
}

export type ScopeOverride = { readonly name: string; readonly href: string };

export function scopeOverride(
  router: Router,
  entry: SettingEntry,
  answer: SettingAnswer,
  project: Project | null,
): ScopeOverride | undefined {
  const over = answer.overriddenBy;
  if (over === undefined) return undefined;
  return { name: scopeName(over.scope, project), href: settingsHref(router, entry.section, over.scope) };
}
