import type { FoundFile } from '@tagma/server/checkout-files/contract/wire/paths';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { SearchHit } from '@tagma/server/graph/contract/wire/reads';
import type { SettingEntry } from '@tagma/server/settings/contract/wire/catalog';
import type { ConversationHit } from '@tagma/server/threads/contract/wire/conversation';
import type { HistoryCommit } from '@tagma/server/workspace/contract/wire/history';
import { untrack } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { rank, terms } from '@runlith/search-text/match';
import type { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import type { ActionEnv, PaletteAction } from '$lib/features/workspace/action.js';
import { Feed } from '$lib/features/palette/Feed.svelte.js';
import { type FilesAim, FilesFeed, fileTargetOf } from '$lib/features/palette/Files.svelte.js';
import type { BlocksAsk, CommitsAsk, PaletteRepo, ThreadsAsk, ThreadsCoverage } from '$lib/features/palette/Repo.js';
import { GROUPS, type GroupId } from '$lib/app/panes/palette.js';
import { type Chip, GROUP_TITLES, narrowed, type Narrowed, prefixed } from '$lib/features/palette/query.js';
import { settingTarget } from '$lib/features/settings/match.js';
import { labelOf } from '$lib/features/workspace/mark.js';
import type { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import type { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { Door } from '$lib/wire/Door.js';
import { Refusal } from '$lib/wire/refusal.js';

export const SHOWN = 3;

export type Row =
  | { readonly kind: 'project'; readonly value: string; readonly project: Project; readonly positions: readonly number[] }
  | { readonly kind: 'file'; readonly value: string; readonly hit: FoundFile; readonly line: number | null; readonly column: number | null }
  | { readonly kind: 'thread'; readonly value: string; readonly hit: ConversationHit }
  | { readonly kind: 'block'; readonly value: string; readonly hit: SearchHit }
  | { readonly kind: 'commit'; readonly value: string; readonly commit: HistoryCommit }
  | { readonly kind: 'setting'; readonly value: string; readonly entry: SettingEntry; readonly positions: readonly number[] }
  | { readonly kind: 'action'; readonly value: string; readonly action: PaletteAction; readonly positions: readonly number[] }
  | { readonly kind: 'ask'; readonly value: string; readonly text: string };

export type Section = {
  readonly group: GroupId;
  readonly title: string;
  readonly rows: readonly Row[];
  readonly count: string | null;
  readonly showAll: string | null;
  readonly more: boolean;
  readonly loading: boolean;
  readonly failure: string | null;
  readonly notes: readonly string[];
};

export const ASK_VALUE = 'ask';

type Parsed = { readonly aim: GroupId | 'ask' | null; readonly words: Narrowed };

export interface FilesPort {
  aim(): FilesAim | null;
}

type Plan = {
  readonly project: { readonly id: number; readonly name: string } | null;
  readonly files: { readonly aim: FilesAim; readonly query: string } | null;
  readonly threads: { readonly text: string; readonly reach: 'project' | 'all' } | null;
  readonly blocks: { readonly text: string; readonly tag: string | null; readonly status: string | null } | null;
  readonly commits: { readonly text: string } | null;
};

type Shape = {
  readonly rows: readonly Row[];
  readonly total: number | null;
  readonly atLeast: number | null;
  readonly next: string | null;
  readonly loading: boolean;
  readonly failure: string | null;
  readonly notes: readonly string[];
};

const tooShort = (error: unknown): boolean => error instanceof Refusal && error.code === 'query-too-short';

const APPROXIMATE = 'Nothing matches as typed; showing close spellings.';

function failureOf(error: unknown): string | null {
  if (error === null || tooShort(error)) return null;
  return error instanceof Refusal ? error.reason : 'Could not search.';
}

const local = (rows: readonly Row[]): Shape => ({
  rows,
  total: rows.length,
  atLeast: null,
  next: null,
  loading: false,
  failure: null,
  notes: [],
});

export class PaletteModel {
  query = $state('');
  chip = $state<Chip>('all');
  reach = $state<'project' | 'all'>('project');

  private readonly opened = new SvelteSet<GroupId>();

  readonly threads: Feed<ConversationHit, ThreadsCoverage, ThreadsAsk>;
  readonly blocks: Feed<SearchHit, null, BlocksAsk>;
  readonly commits: Feed<HistoryCommit, null, CommitsAsk>;
  readonly files: FilesFeed;

  constructor(
    private readonly workspace: Workspace,
    private readonly tags: () => TagCatalog | null,
    repo: PaletteRepo,
    private readonly settings: SettingsRepo,
    private readonly declared: () => readonly PaletteAction[],
    private readonly env: () => ActionEnv,
    private readonly place: FilesPort,
    door: Door,
  ) {
    this.files = new FilesFeed(door);
    this.reach = workspace.active === null ? 'all' : 'project';
    this.threads = new Feed((_text, aim, cursor) => repo.threads.key({ ...aim, cursor }));
    this.blocks = new Feed((_text, aim, cursor) => repo.blocks.key({ ...aim, cursor }));
    this.commits = new Feed((_text, aim, cursor) => repo.commits.key({ ...aim, cursor }));
    $effect(() => {
      const plan = this.plan;
      untrack(() => this.dispatch(plan));
    });
    $effect(() => () => this.stop());
  }

  get project(): Project | null {
    return this.workspace.contextProject;
  }

  private get parsed(): Parsed {
    const { aim, text } = prefixed(this.query);
    const tags = this.tags();
    return { aim, words: narrowed(text, tags?.declared ?? [], tags?.statuses ?? []) };
  }

  get text(): string {
    return this.parsed.words.text;
  }

  get target(): { readonly query: string; readonly line: number | null; readonly column: number | null } {
    return fileTargetOf(this.parsed.words.text);
  }

  get asking(): boolean {
    return this.parsed.aim === 'ask';
  }

  get narrowing(): boolean {
    const { words } = this.parsed;
    return words.tag !== null || words.status !== null;
  }

  get focus(): GroupId | null {
    const { aim } = this.parsed;
    if (aim !== null && aim !== 'ask') return aim;
    if (this.narrowing) return 'blocks';
    return this.chip === 'all' ? null : this.chip;
  }

  private get plan(): Plan {
    const { words } = this.parsed;
    const focus = this.focus;
    const project = this.project;
    const wanted = (group: GroupId): boolean => !this.asking && project !== null && (focus === null || focus === group);
    const aim = this.place.aim();
    const target = this.target;
    return {
      project: project === null ? null : { id: project.id, name: project.name },
      files: wanted('files') && aim !== null && (target.query !== '' || focus === 'files') ? { aim, query: target.query } : null,
      threads: wanted('threads') && words.text !== '' ? { text: words.text, reach: this.reach } : null,
      blocks: wanted('blocks') && (words.text !== '' || this.narrowing) ? { text: words.text, tag: words.tag, status: words.status } : null,
      commits: wanted('commits') && words.text !== '' ? { text: words.text } : null,
    };
  }

  private dispatch(plan: Plan): void {
    const { project, files, threads, blocks, commits } = plan;
    if (project === null) return this.stop();
    if (files === null) this.files.clear();
    else this.files.ask(files.aim, files.query);
    if (threads === null) this.threads.clear();
    else {
      this.threads.ask(threads.text, {
        projectId: project.id,
        projectName: project.name,
        query: threads.text,
        reach: threads.reach,
        cursor: null,
      });
    }
    if (blocks === null) this.blocks.clear();
    else {
      this.blocks.ask(blocks.text, { projectId: project.id, query: blocks.text, tag: blocks.tag, status: blocks.status, cursor: null });
    }
    if (commits === null) this.commits.clear();
    else this.commits.ask(commits.text, { projectId: project.id, grep: commits.text, cursor: null });
  }

  private stop(): void {
    this.files.clear();
    this.threads.clear();
    this.blocks.clear();
    this.commits.clear();
  }

  expand(group: GroupId): void {
    this.opened.add(group);
  }

  more(group: GroupId): void {
    if (group === 'threads') this.threads.more();
    else if (group === 'blocks') this.blocks.more();
    else if (group === 'commits') this.commits.more();
  }

  get sections(): readonly Section[] {
    if (this.asking) return [];
    const focus = this.focus;
    const sections: Section[] = [];
    for (const group of GROUPS) {
      if (focus !== null && focus !== group) continue;
      const shape = this.shapeOf(group);
      if (shape === null) continue;
      if (shape.rows.length === 0 && shape.failure === null && shape.notes.length === 0) continue;
      sections.push(this.sectionOf(group, shape, focus !== null || this.opened.has(group) || this.text === ''));
    }
    return sections;
  }

  private sectionOf(group: GroupId, shape: Shape, open: boolean): Section {
    const { rows, total, atLeast, next } = shape;
    const hidden = open ? 0 : Math.max(rows.length - SHOWN, 0);
    const known = total !== null ? String(total) : atLeast !== null ? `${atLeast}+` : `${rows.length}${next === null ? '' : '+'}`;
    return {
      group,
      title: GROUP_TITLES[group],
      rows: open ? rows : rows.slice(0, SHOWN),
      count: rows.length === 0 ? null : known,
      showAll: !open && (hidden > 0 || next !== null) ? `Show all ${known}` : null,
      more: open && next !== null,
      loading: shape.loading,
      failure: shape.failure,
      notes: shape.notes,
    };
  }

  private shapeOf(group: GroupId): Shape | null {
    if (group === 'actions') return local(this.actionRows());
    if (group === 'projects') return local(this.projectRows());
    const project = this.project;
    if (project === null) return null;
    if (group === 'settings') return this.settingShape(project.id);
    if (group === 'files') return this.fileShape();
    if (group === 'threads') return this.threadShape();
    if (group === 'blocks') {
      const feed = this.blocks;
      const rows = feed.rows.map((hit): Row => ({ kind: 'block', value: `block:${hit.identity}`, hit }));
      return {
        rows,
        total: feed.total,
        atLeast: null,
        next: feed.next,
        loading: feed.loading,
        failure: failureOf(feed.failure),
        notes: feed.approximate ? [APPROXIMATE] : [],
      };
    }
    const feed = this.commits;
    const rows = feed.rows.map((commit): Row => ({ kind: 'commit', value: `commit:${commit.sha}`, commit }));
    return { rows, total: feed.total, atLeast: null, next: feed.next, loading: feed.loading, failure: failureOf(feed.failure), notes: [] };
  }

  private fileShape(): Shape {
    const feed = this.files;
    const { line, column } = this.target;
    const rows = feed.rows.map((hit): Row => ({ kind: 'file', value: `file:${hit.path}`, hit, line, column }));
    return {
      rows,
      total: feed.matched,
      atLeast: null,
      next: null,
      loading: feed.loading,
      failure: failureOf(feed.failure),
      notes: [],
    };
  }

  private projectRows(): readonly Row[] {
    if (terms(this.text).length === 0 && this.focus !== 'projects') return [];
    return rank(this.workspace.projects, this.text, (project) => ({ name: labelOf(project), names: [project.name] })).map(
      ({ item: project, hit }): Row => ({ kind: 'project', value: `project:${project.id}`, project, positions: hit.positions }),
    );
  }

  private actionRows(): readonly Row[] {
    const env = this.env();
    const available = this.declared().filter((action) => action.available?.(env) ?? true);
    return rank(available, this.text, (action) => ({ name: action.title, text: action.keywords })).map(({ item: action, hit }): Row => ({
      kind: 'action',
      value: `action:${action.id}`,
      action,
      positions: hit.positions,
    }));
  }

  private settingShape(projectId: number): Shape {
    if (terms(this.text).length === 0) return local([]);
    const catalog = this.settings.catalog.key(projectId);
    const data = catalog.data;
    if (data === undefined) {
      const error = catalog.error;
      return { ...local([]), loading: error === undefined, failure: error === undefined ? null : failureOf(error) };
    }
    const rows = rank(
      data.entries.filter((entry) => entry.control?.kind !== 'machine'),
      this.text,
      settingTarget,
    ).map(({ item: entry, hit }): Row => ({ kind: 'setting', value: `setting:${entry.id}`, entry, positions: hit.positions }));
    return local(rows);
  }

  private threadShape(): Shape {
    const feed = this.threads;
    const rows = feed.rows.map((hit): Row => ({ kind: 'thread', value: `thread:${hit.threadId}`, hit }));
    const notes: string[] = [];
    if (tooShort(feed.failure)) notes.push('Add a longer word to search the conversations.');
    if (feed.approximate) notes.push(APPROXIMATE);
    const coverage = feed.extra;
    if (coverage !== null && !coverage.complete) {
      const unread = `${coverage.unindexed} ${coverage.unindexed === 1 ? 'thread is' : 'threads are'} not indexed yet`;
      notes.push(rows.length === 0 ? `No indexed thread says this; ${unread}.` : `${unread}, so there may be more.`);
    }
    return {
      rows,
      total: feed.total,
      atLeast: feed.atLeast,
      next: feed.next,
      loading: feed.loading,
      failure: failureOf(feed.failure),
      notes,
    };
  }
}
