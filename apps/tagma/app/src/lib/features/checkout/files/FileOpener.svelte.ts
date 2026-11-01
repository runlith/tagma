import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type { PathEntry, PlacedPath } from '@tagma/server/checkout-files/contract/wire/place';
import { diskAddress } from './disk.js';
import type { PathPlace } from './Outside.svelte.js';
import { Router } from '@runlith/layer/Router';
import { Service } from '@runlith/layer/key';
import { KeyedClaims } from '$lib/shared/Claims.svelte.js';
import { ExternalLinks, type LinkPort } from '$lib/shared/ExternalLinks.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Beside, type BesidePort } from '$lib/features/opening/Beside.js';
import type { LinkFrom } from '$lib/features/opening/Link.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { FILE_PANE, type FileTarget, filePane, fileTargetOf, sameFile } from '../paneContent.js';
import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import { Door } from '$lib/wire/Door.js';

export type PathTarget = {
  readonly path: string;
  readonly line?: number | null | undefined;
  readonly column?: number | null | undefined;
};

export type Picture = { readonly url: string; readonly name: string; readonly mediaType: string };

export type OpenAsk = {
  readonly project?: number | undefined;
  readonly from?: string | undefined;
  readonly root?: RootId | undefined;
  readonly thread?: string | undefined;
  readonly beside?: LinkFrom | undefined;
  readonly reveal?: boolean | undefined;
  readonly picture?: ((picture: Picture) => void) | undefined;
};

export type Located = {
  readonly path: string;
  readonly branch: string | null;
  readonly line: number | null;
  readonly column: number | null;
} & ({ readonly rootId: RootId; readonly projectId: number } | { readonly rootId: null; readonly projectId: null });

type At = { readonly line: number | null; readonly column: number | null };

export type CheckoutPage = { readonly aim: GraphAim; readonly name: string };

export interface CheckoutSurface {
  rootId(): RootId | null;
  show(located: Located, reveal: boolean): void;
}

type Waiting = { readonly located: Located; readonly reveal: boolean };

export class FileOpener extends Service<FileOpener>()('FileOpener', { tier: 'app' }) {
  static *make() {
    return new FileOpener(
      yield* Door,
      yield* GraphRung.Source,
      yield* ProjectsRepo,
      yield* Router,
      yield* Addresses,
      yield* Notices,
      yield* ExternalLinks,
      yield* Beside,
    );
  }

  private readonly surfaces = new KeyedClaims<string, CheckoutSurface>();
  private readonly waiting = new Map<string, Waiting>();
  private pending: AbortController | null = null;

  constructor(
    private readonly door: Door,
    private readonly aim: () => GraphAim | undefined,
    private readonly projects: ProjectsRepo,
    private readonly router: Router,
    private readonly addresses: Addresses,
    private readonly notices: Notices,
    private readonly links: LinkPort,
    private readonly beside: BesidePort,
  ) {
    super();
  }

  stand(aim: GraphAim, surface: CheckoutSurface): () => void {
    const key = GraphRung.keyOf(aim);
    const release = this.surfaces.take(key, surface);
    const waited = this.waiting.get(key);
    if (waited !== undefined) {
      this.waiting.delete(key);
      surface.show(waited.located, waited.reveal);
    }
    return release;
  }

  async resolve(
    path: string,
    from?: string,
    signal?: AbortSignal,
    project: number | undefined = this.aim()?.projectId,
    root?: RootId,
    thread?: string,
  ): Promise<{ entry: PathEntry | null; place: PlacedPath | null }> {
    if (project === undefined) return { entry: null, place: null };
    return this.door.perform(
      'place_path',
      { path, from, root, thread },
      { project: String(project) },
      signal === undefined ? {} : { signal },
    );
  }

  async place(target: PathTarget, ask: OpenAsk = {}, signal?: AbortSignal): Promise<PathPlace | null> {
    const { place, entry: file } = await this.resolve(target.path, ask.from, signal, ask.project, ask.root, ask.thread);
    if (file?.kind !== 'file') return null;
    const line = target.line ?? null;
    return {
      file:
        place === null
          ? { projectId: null, rootId: null, path: file.path, line }
          : { projectId: place.projectId, rootId: place.checkout, path: place.path, line },
      absolute: file.path,
    };
  }

  async open(target: PathTarget, ask: OpenAsk = {}): Promise<void> {
    const aim = this.aim();
    if (aim === undefined) return;
    const key = GraphRung.keyOf(aim);
    this.pending?.abort();
    this.waiting.clear();
    const pending = new AbortController();
    this.pending = pending;
    const current = (): boolean => !pending.signal.aborted && this.aim() !== undefined && GraphRung.keyOf(this.aim() as GraphAim) === key;
    try {
      const { place, entry: file } = await this.resolve(
        target.path,
        ask.from,
        pending.signal,
        ask.project ?? aim.projectId,
        ask.root,
        ask.thread,
      );
      if (!current() || file?.kind !== 'file') return;
      if (ask.picture !== undefined && file.mediaType.startsWith('image/') && file.mediaType !== 'image/svg+xml') {
        ask.picture({
          url: diskAddress(this.door, file.path),
          name: file.path.slice(file.path.lastIndexOf('/') + 1),
          mediaType: file.mediaType,
        });
        return;
      }
      if (!this.drawn(file.path, file.mediaType)) return;
      const line = target.line ?? null;
      const column = line === null ? null : (target.column ?? null);
      const at = { line, column };
      const tabbed: FileTarget =
        place === null
          ? { projectId: null, rootId: null, path: file.path, at: line === null ? null : { line, column } }
          : { projectId: place.projectId, rootId: place.checkout, path: place.path, at: line === null ? null : { line, column } };
      if (ask.beside !== undefined && this.besideShows(tabbed, ask.beside)) return;
      const reveal = ask.reveal === true;
      const surface = this.surfaces.get(key);
      if (place !== null && (place.projectId !== aim.projectId || (reveal && surface?.rootId() !== place.checkout))) {
        await this.elsewhere(place, at, current, reveal);
        return;
      }
      if (surface === undefined) return;
      const branch = place === null || surface.rootId() === place.checkout ? null : await this.branchOf(aim.projectId, place.root);
      if (!current()) return;
      surface.show(
        place === null
          ? { rootId: null, projectId: null, path: file.path, branch, ...at }
          : { rootId: place.checkout, projectId: place.projectId, path: place.path, branch, ...at },
        reveal,
      );
      await this.router.goto(this.addresses.git('tree', aim.branch));
    } catch (error) {
      if (!pending.signal.aborted) this.notices.refusal(error);
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  shows(absolute: string, mediaType: string): boolean {
    this.pending?.abort();
    this.pending = null;
    this.waiting.clear();
    return this.drawn(absolute, mediaType);
  }

  private drawn(absolute: string, mediaType: string): boolean {
    if (mediaType !== 'application/pdf') return true;
    this.links.open(diskAddress(this.door, absolute));
    return false;
  }

  private besideShows(target: FileTarget, from: LinkFrom): boolean {
    return this.beside.show({
      content: filePane(target),
      from,
      standing: (tabs) => tabs.find((pane) => pane.kind === FILE_PANE && sameFile(fileTargetOf(pane.id), target)),
    });
  }

  async pageOf(place: PlacedPath): Promise<CheckoutPage | null> {
    const [projects, branches] = await Promise.all([
      this.projects.list.loadOrThrow(),
      this.projects.branches.key(place.projectId).loadOrThrow(),
    ]);
    const name = projects?.find((project) => project.id === place.projectId)?.name;
    if (name === undefined) return null;
    const row = branches?.find((one) => one.worktree === place.root);
    if (row === undefined) {
      this.notices.error(
        'This path cannot be opened here',
        `${place.path} stands in a checkout of ${name} that no branch of its page shows.`,
      );
      return null;
    }
    return { aim: { projectId: place.projectId, branch: row.canonical ? null : row.branch }, name };
  }

  private async elsewhere(place: PlacedPath, at: At, current: () => boolean, reveal: boolean): Promise<void> {
    const page = await this.pageOf(place);
    if (page === null || !current()) return;
    const there = page.aim;
    const located: Located = { rootId: place.checkout, projectId: place.projectId, path: place.path, branch: null, ...at };
    const surface = this.surfaces.get(GraphRung.keyOf(there));
    if (surface === undefined) this.waiting.set(GraphRung.keyOf(there), { located, reveal });
    else surface.show(located, reveal);
    await this.router.goto(this.addresses.git('tree', there.branch, page.name));
  }

  private async branchOf(projectId: number, root: string): Promise<string | null> {
    const rows = await this.projects.branches.key(projectId).loadOrThrow();
    return rows?.find((row) => row.worktree === root)?.branch ?? null;
  }
}
