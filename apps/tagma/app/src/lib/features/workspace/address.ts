import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import type { Router } from '@runlith/layer/Router';

export const currentProject = (router: Router): string => router.params.project as string;

export const projectOpen = (router: Router): boolean => typeof router.params.project === 'string' && router.params.project !== '';

export function currentBranch(router: Router): string | null {
  return router.url.searchParams.get('branch');
}

export const carriedQuery = (router: Router, project: string, diff?: string, aimed?: string | null): string => {
  const parts: string[] = [];
  const branch = aimed === undefined ? (project === currentProject(router) ? currentBranch(router) : null) : aimed;
  if (branch !== null) parts.push(`branch=${encodeURIComponent(branch)}`);
  if (diff !== undefined) parts.push(`diff=${diff}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
};

export function branchHref(router: Router, branch: string | null): string {
  const url = new URL(router.url);
  if (branch === null) url.searchParams.delete('branch');
  else url.searchParams.set('branch', branch);
  if (DIFF_RANGE.test(url.searchParams.get('diff') ?? '')) url.searchParams.delete('diff');
  return `${url.pathname}${url.search}`;
}

export function currentPlace(router: Router): string | null {
  const id = router.params.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

export function diffLensHref(router: Router, diff: string | null): string {
  const url = new URL(router.url);
  if (diff === null) url.searchParams.delete('diff');
  else url.searchParams.set('diff', diff);
  return `${url.pathname}${url.search}`;
}

export function settingsHref(router: Router, section?: string, scope?: SettableScope, key?: string, project?: string): string {
  const params = new URLSearchParams();
  const aimed = project ?? router.url.searchParams.get('project');
  const foreign = aimed !== null && aimed !== currentProject(router);
  const branch = project !== undefined && foreign ? null : currentBranch(router);
  if (foreign) params.set('project', aimed);
  if (branch !== null) params.set('branch', branch);
  if (section !== undefined) params.set('section', section);
  if (scope !== undefined) params.set('scope', scope);
  if (key !== undefined) params.set('key', key);
  const search = params.toString();
  return search === '' ? '/settings' : `/settings?${search}`;
}

export type GitView = 'board' | 'tree';

export function currentGitView(router: Router): GitView | null {
  const raw = router.url.searchParams.get('view');
  return raw === 'board' || raw === 'tree' ? raw : null;
}

export function currentCommit(router: Router): string | null {
  const raw = router.url.searchParams.get('commit');
  return raw === null || raw === '' ? null : raw;
}

export type DiffRange = { readonly kind: 'read' } | { readonly kind: 'range'; from: number; to: number | null };

const DIFF_RANGE = /^(\d+)\.\.(\d*)$/;

export function currentDiffRange(router: Router): DiffRange | null {
  return diffRangeOf(router.url.searchParams.get('diff'));
}

export function diffRangeOf(raw: string | null): DiffRange | null {
  if (raw === 'read') return { kind: 'read' };
  const match = raw === null ? null : DIFF_RANGE.exec(raw);
  if (!match) return null;
  return { kind: 'range', from: Number(match[1]), to: match[2] ? Number(match[2]) : null };
}

export function diffParam(range: { from: number; to: number | null }): string {
  return `${range.from}..${range.to ?? ''}`;
}
