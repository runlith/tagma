import Copy from '@lucide/svelte/icons/copy';
import FolderOpen from '@lucide/svelte/icons/folder-open';
import FolderTree from '@lucide/svelte/icons/folder-tree';
import GitBranch from '@lucide/svelte/icons/git-branch';
import PanelRight from '@lucide/svelte/icons/panel-right';
import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
import type { PlacedPath } from '@tagma/server/checkout-files/contract/wire/place';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type { Resolver } from '@runlith/layer/key';
import { Router } from '@runlith/layer/Router';
import { Beside } from '$lib/features/opening/Beside.js';
import type { Link, LinkFrom, LinkItems, LinkKind } from '$lib/features/opening/Link.js';
import { FileOpener, type OpenAsk, type PathTarget, type Picture } from './files/FileOpener.svelte.js';
import { Outside } from './files/Outside.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { CHECKOUT } from '$lib/features/workspace/surface.js';
import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import { Column } from './files/Column.svelte.js';
import { CHANGES_PANE, changesPane, COMMIT_PANE, commitOf, commitPane, FILE_PANE, fileTargetOf } from './paneContent.js';
import { SHORT_SHA } from './reading.js';
import { ThreadChanges } from './ThreadChanges.svelte.js';

export const FILE_LINK = 'file';

export const COMMIT_LINK = 'commit';

export const CHANGE_LINK = 'change';

export const CHANGES_LINK = 'changes';

export const DIRECTORY_LINK = 'directory';

export type FileRef = PathTarget & {
  readonly root?: RootId | undefined;
  readonly picture?: ((picture: Picture) => void) | undefined;
};

export type CommitRef = { readonly sha: string; readonly project: string; readonly subject?: string | undefined };

export type ChangeRef = { readonly projectId: number; readonly rootId: RootId; readonly path: string; readonly commit: string | null };

export type ChangesRef = { readonly threadId: string; readonly summary?: string | undefined };

export type DirectoryRef = { readonly absolute: string; readonly place: PlacedPath | null };

export const fileLink = (target: FileRef, from?: LinkFrom): Link<FileRef> => ({ kind: FILE_LINK, target, from });

export const commitLink = (target: CommitRef, from?: LinkFrom): Link<CommitRef> => ({ kind: COMMIT_LINK, target, from });

export const changeLink = (target: ChangeRef, from?: LinkFrom): Link<ChangeRef> => ({ kind: CHANGE_LINK, target, from });

export const changesLink = (target: ChangesRef, from?: LinkFrom): Link<ChangesRef> => ({ kind: CHANGES_LINK, target, from });

export const directoryLink = (target: DirectoryRef, from?: LinkFrom): Link<DirectoryRef> => ({ kind: DIRECTORY_LINK, target, from });

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

const lined = (text: string, line: number | null | undefined): string => (line == null ? text : `${text}:${line}`);

const spotOf = (target: FileRef): PathTarget => ({ path: target.path, line: target.line, column: target.column });

const askOf = (link: Link<FileRef>): OpenAsk => ({
  project: link.from?.project,
  from: link.from?.folder,
  root: link.target.root,
  picture: link.target.picture,
});

const files: LinkKind<FileRef> = {
  kind: FILE_LINK,
  what: (_app, link) => lined(nameOf(link.target.path), link.target.line),
  beside: {
    words: 'Open beside',
    icon: PanelRight,
    open: (app, link) => app.resolve(FileOpener).open(spotOf(link.target), { ...askOf(link), beside: link.from ?? {} }),
  },
  full: {
    words: 'Open in Files',
    icon: FolderTree,
    open: (app, link) => app.resolve(FileOpener).open(spotOf(link.target), { ...askOf(link), reveal: true }),
  },
  tab: {
    kind: FILE_PANE,
    link: (_app, id) => {
      const target = fileTargetOf(id);
      return target === null
        ? null
        : fileLink(
            { path: target.path, line: target.at?.line ?? null, column: target.at?.column ?? null, root: target.rootId ?? undefined },
            { project: target.projectId ?? undefined },
          );
    },
  },
};

const placed = (app: Resolver, link: Link<FileRef>) => app.resolve(FileOpener).place(spotOf(link.target), askOf(link));

const fileOf = (link: Link<ChangeRef>): Link<FileRef> =>
  fileLink({ path: link.target.path, root: link.target.rootId }, { ...link.from, project: link.target.projectId });

const outsideActs = (app: Resolver, link: Link<FileRef>) => {
  const outside = app.resolve(Outside);
  return [
    ...outside.editors.map((editor) => ({
      id: `editor:${editor.id}`,
      words: `Open in ${editor.name}`,
      icon: SquareArrowOutUpRight,
      run: async () => {
        const place = await placed(app, link);
        if (place !== null) await outside.open(place.file, editor.id);
      },
    })),
    ...(outside.local
      ? [
          {
            id: 'reveal',
            words: outside.finder,
            icon: FolderOpen,
            run: async () => {
              const place = await placed(app, link);
              if (place !== null) await outside.reveal(place.file);
            },
          },
        ]
      : []),
  ];
};

const pathActs = (app: Resolver, link: Link<FileRef>) => [
  {
    id: 'copy-path',
    words: 'Copy path',
    icon: Copy,
    run: async () => {
      const place = await placed(app, link);
      await navigator.clipboard.writeText(place?.absolute ?? link.target.path);
    },
  },
  {
    id: 'copy-path-line',
    words: 'Copy path:line',
    icon: Copy,
    run: async () => {
      const place = await placed(app, link);
      await navigator.clipboard.writeText(lined(place?.absolute ?? link.target.path, link.target.line));
    },
  },
];

const outsides: LinkItems<FileRef> = { kind: FILE_LINK, order: 10, group: 'places', acts: outsideActs };

const paths: LinkItems<FileRef> = { kind: FILE_LINK, order: 100, group: 'copies', acts: pathActs };

const projectIdOf = (app: Resolver, name: string): number | undefined =>
  app.resolve(Workspace).projects.find((project) => project.name === name)?.id;

const commits: LinkKind<CommitRef> = {
  kind: COMMIT_LINK,
  what: (_app, link) => link.target.subject ?? link.target.sha.slice(0, SHORT_SHA),
  beside: {
    words: 'Open beside',
    icon: PanelRight,
    open: async (app, link) => {
      const projectId = projectIdOf(app, link.target.project);
      if (projectId === undefined || !app.resolve(Beside).show({ content: commitPane(projectId, link.target.sha), from: link.from }))
        await commits.full.open(app, link);
    },
  },
  full: {
    words: 'Open in Git',
    icon: GitBranch,
    open: async (app, link) => {
      await app.resolve(Router).goto(app.resolve(Addresses).commit(link.target.sha, link.target.project));
    },
  },
  tab: {
    kind: COMMIT_PANE,
    link: (app, id) => {
      const shown = commitOf(id);
      const project = shown === null ? null : app.resolve(Workspace).find(shown.projectId);
      return shown === null || project === null ? null : commitLink({ sha: shown.sha, project: project.name });
    },
  },
};

const shas: LinkItems<CommitRef> = {
  kind: COMMIT_LINK,
  order: 100,
  group: 'copies',
  acts: (_app, link) => [{ id: 'copy-sha', words: 'Copy SHA', icon: Copy, run: () => navigator.clipboard.writeText(link.target.sha) }],
};

const changes: LinkKind<ChangeRef> = {
  kind: CHANGE_LINK,
  what: (_app, link) => nameOf(link.target.path),
  beside: {
    words: 'Open diff beside',
    icon: PanelRight,
    open: async (app, link) => {
      const { projectId, rootId, path, commit } = link.target;
      const changed = app.resolve(ThreadChanges);
      const standing = changed.open;
      const same =
        standing !== null &&
        standing.rootId === rootId &&
        standing.path === path &&
        standing.commit === commit &&
        standing.lens === undefined;
      if (!same) changed.open = { projectId, rootId, path, commit };
      if (!app.resolve(Beside).show({ content: changesPane, from: { ...link.from, thread: changed.threadId } }))
        await changes.full.open(app, link);
    },
  },
  full: {
    words: (_app, link) => (link.target.commit === null ? 'Open in Files' : 'Open in Git'),
    icon: GitBranch,
    open: async (app, link) => {
      const { commit } = link.target;
      if (commit === null) return files.full.open(app, fileOf(link));
      const project = app.resolve(Workspace).find(link.target.projectId);
      if (project !== null) await app.resolve(Router).goto(app.resolve(Addresses).commit(commit, project.name));
    },
  },
};

const changeLists: LinkKind<ChangesRef> = {
  kind: CHANGES_LINK,
  what: (_app, link) => link.target.summary ?? 'Changes',
  beside: {
    words: 'Open beside',
    icon: PanelRight,
    open: async (app, link) => {
      if (!app.resolve(Beside).show({ content: changesPane, from: { ...link.from, thread: link.target.threadId } }))
        await changeLists.full.open(app, link);
    },
  },
  full: {
    words: 'Open in Git',
    icon: GitBranch,
    open: async (app) => {
      app.resolve(Column).show('git');
      await shellActs(app.resolve(ShellOps), app.resolve(Notices)).revealSurface(CHECKOUT);
    },
  },
  tab: {
    kind: CHANGES_PANE,
    link: (app) => {
      const thread = app.resolve(SidePanes).main?.activeId ?? null;
      return thread === null ? null : changesLink({ threadId: thread });
    },
  },
};

const changePlaces: LinkItems<ChangeRef> = {
  kind: CHANGE_LINK,
  order: 10,
  group: 'places',
  acts: (app, link) => outsideActs(app, fileOf(link)),
};

const changePaths: LinkItems<ChangeRef> = {
  kind: CHANGE_LINK,
  order: 100,
  group: 'copies',
  acts: (app, link) => {
    const { commit } = link.target;
    return [
      ...pathActs(app, fileOf(link)),
      ...(commit === null ? [] : [{ id: 'copy-sha', words: 'Copy SHA', icon: Copy, run: () => navigator.clipboard.writeText(commit) }]),
    ];
  },
};

const revealed = (outside: Outside, absolute: string) => outside.reveal({ projectId: null, rootId: null, path: absolute, line: null });

const directories: LinkKind<DirectoryRef> = {
  kind: DIRECTORY_LINK,
  what: (_app, link) => nameOf(link.target.absolute),
  full: {
    words: (app, link) => (link.target.place === null ? app.resolve(Outside).finder : 'Open in Files'),
    icon: FolderTree,
    open: async (app, link) => {
      const opener = app.resolve(FileOpener);
      const { entry, place } = await opener.resolve(link.target.absolute, undefined, undefined, link.from?.project);
      if (entry?.kind !== 'directory') return;
      if (place === null) return revealed(app.resolve(Outside), entry.path);
      const page = await opener.pageOf(place);
      if (page === null) return;
      await app
        .resolve(Column)
        .point({ root: place.checkout, path: place.path }, app.resolve(Addresses).git('tree', page.aim.branch, page.name));
    },
  },
};

const directoryPlaces: LinkItems<DirectoryRef> = {
  kind: DIRECTORY_LINK,
  order: 10,
  group: 'places',
  acts: (app, link) => {
    const outside = app.resolve(Outside);
    return outside.local && link.target.place !== null
      ? [{ id: 'reveal', words: outside.finder, icon: FolderOpen, run: () => revealed(outside, link.target.absolute) }]
      : [];
  },
};

const directoryPaths: LinkItems<DirectoryRef> = {
  kind: DIRECTORY_LINK,
  order: 100,
  group: 'copies',
  acts: (_app, link) => [
    { id: 'copy-path', words: 'Copy path', icon: Copy, run: () => navigator.clipboard.writeText(link.target.absolute) },
  ],
};

export const links = [files, commits, changes, changeLists, directories];

export const items = [outsides, paths, shas, changePlaces, changePaths, directoryPlaces, directoryPaths];
