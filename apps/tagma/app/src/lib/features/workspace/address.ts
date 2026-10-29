import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import type { Router } from '@runlith/layer/Router';

export const currentProject = (router: Router): string => router.params.project as string;

export function renamedHref(router: Router, renamed: ReadonlyMap<string, string>): string | null {
  const url = new URL(router.url);
  const at = router.routeId?.split('/').indexOf('[project]') ?? -1;
  const segments = url.pathname.split('/');
  const named = at < 0 ? undefined : renamed.get(router.params.project ?? '');
  if (named !== undefined) segments[at] = encodeURIComponent(named);
  const aimed = renamed.get(url.searchParams.get('project') ?? '');
  if (aimed !== undefined) url.searchParams.set('project', aimed);
  if (named === undefined && aimed === undefined) return null;
  return `${segments.join('/')}${url.search}${url.hash}`;
}

export const projectOpen = (router: Router): boolean => typeof router.params.project === 'string' && router.params.project !== '';

export function currentBranch(router: Router): string | null {
  return router.url.searchParams.get('branch');
}

export type BlockLens = { readonly diff?: string | undefined; readonly lang?: string | undefined };

export const carriedQuery = (router: Router, project: string, lens: BlockLens = {}, aimed?: string | null): string => {
  const parts: string[] = [];
  const branch = aimed === undefined ? (project === currentProject(router) ? currentBranch(router) : null) : aimed;
  if (branch !== null) parts.push(`branch=${encodeURIComponent(branch)}`);
  if (lens.diff !== undefined) parts.push(`diff=${encodeURIComponent(lens.diff)}`);
  else if (lens.lang !== undefined) parts.push(`lang=${encodeURIComponent(lens.lang)}`);
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
  url.searchParams.delete('lang');
  if (diff === null) url.searchParams.delete('diff');
  else url.searchParams.set('diff', diff);
  return `${url.pathname}${url.search}`;
}

export function languageLensHref(router: Router, lang: string | null): string {
  const url = new URL(router.url);
  url.searchParams.delete('diff');
  if (lang === null) url.searchParams.delete('lang');
  else url.searchParams.set('lang', lang);
  return `${url.pathname}${url.search}`;
}

export function languageTag(raw: string | null): string | null {
  if (raw === null || raw === '') return null;
  try {
    return Intl.getCanonicalLocales(raw)[0] ?? null;
  } catch {
    return null;
  }
}

export function currentLanguage(router: Router): string | null {
  return router.url.searchParams.has('diff') ? null : languageTag(router.url.searchParams.get('lang'));
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

export type DiffRange =
  | { readonly kind: 'read' }
  | { readonly kind: 'since'; readonly at: string }
  | { readonly kind: 'range'; from: number; to: number | null };

const DIFF_RANGE = /^(\d+)\.\.(\d*)$/;
const DIFF_SINCE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

export function currentDiffRange(router: Router): DiffRange | null {
  return diffRangeOf(router.url.searchParams.get('diff'));
}

export function diffRangeOf(raw: string | null): DiffRange | null {
  if (raw === 'read') return { kind: 'read' };
  if (raw !== null && DIFF_SINCE.test(raw)) return { kind: 'since', at: raw };
  const match = raw === null ? null : DIFF_RANGE.exec(raw);
  if (!match) return null;
  return { kind: 'range', from: Number(match[1]), to: match[2] ? Number(match[2]) : null };
}

export function diffParam(range: { from: number; to: number | null }): string {
  return `${range.from}..${range.to ?? ''}`;
}
