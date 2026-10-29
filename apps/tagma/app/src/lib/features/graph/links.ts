import Copy from '@lucide/svelte/icons/copy';
import PanelRight from '@lucide/svelte/icons/panel-right';
import Play from '@lucide/svelte/icons/play';
import { blockAddress } from '@tagma/server/graph/contract/wire/references';
import type { Resolver } from '@runlith/layer/key';
import { Router } from '@runlith/layer/Router';
import { Beside } from '$lib/features/opening/Beside.js';
import type { Link, LinkItems, LinkKind, LinkFrom } from '$lib/features/opening/Link.js';
import { type BlockLens, languageTag } from '$lib/features/workspace/address.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import type { GraphAim } from '$lib/features/workspace/GraphRung.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { BlockTitles } from './BlockTitles.svelte.js';
import { BLOCK_PANE, blockPane, placedBlockOf } from './blockPane.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import KnowledgeIcon from './KnowledgeIcon.svelte';
import { ProjectTree } from './ProjectTree.svelte.js';
import { TagCatalog } from './TagCatalog.svelte.js';
import { START_WORDS, startable, ThreadWork } from './ThreadWork.svelte.js';

export const BLOCK_LINK = 'block';

export type BlockTarget = BlockLens & { readonly name: string; readonly copy?: GraphAim | undefined };

export const blockLink = (target: BlockTarget, from?: LinkFrom): Link<BlockTarget> => ({ kind: BLOCK_LINK, target, from });

export async function blockPlace(app: Resolver, target: BlockTarget): Promise<GraphAim | null> {
  return target.copy ?? (await app.resolve(BlockTitles).copy(target.name));
}

export function knowledgeHref(app: Resolver, name: string, copy: GraphAim, lens: BlockLens = {}): string | null {
  const project = app.resolve(Workspace).find(copy.projectId);
  return project === null
    ? null
    : app.resolve(Addresses).block(blockAddress(name).name, { ...lens, project: project.name, branch: copy.branch });
}

async function openFull(app: Resolver, link: Link<BlockTarget>): Promise<void> {
  const { name, diff, lang } = link.target;
  if (link.target.copy === undefined) return app.resolve(BlockTitles).open(name, { diff, lang });
  const href = knowledgeHref(app, name, link.target.copy, { diff, lang });
  if (href !== null) await app.resolve(Router).goto(href);
}

const blocks: LinkKind<BlockTarget> = {
  kind: BLOCK_LINK,
  what: (app, link) => {
    const peer = app.resolve(BlockTitles).peer(link.target.name);
    return peer == null || 'error' in peer ? link.target.name : peer.title.trim() || link.target.name;
  },
  beside: {
    words: 'Open beside',
    icon: PanelRight,
    open: async (app, link) => {
      const copy = await blockPlace(app, link.target);
      if (copy === null) return openFull(app, link);
      const content = blockPane({
        ...copy,
        name: blockAddress(link.target.name).name,
        diff: link.target.diff ?? null,
        lang: link.target.lang ?? null,
      });
      if (!app.resolve(Beside).show({ content, from: link.from })) await openFull(app, link);
    },
  },
  full: { words: 'Open in Knowledge', icon: KnowledgeIcon, open: openFull },
  route: (app, anchor) => {
    const name = anchor.dataset['block'];
    if (name === undefined) return null;
    const url = new URL(anchor.href);
    const project = decodeURIComponent(url.pathname.split('/')[1] ?? '');
    const owner = app.resolve(Workspace).projects.find((one) => one.name === project);
    const copy = owner === undefined ? undefined : { projectId: owner.id, branch: url.searchParams.get('branch') };
    return blockLink({
      name,
      copy,
      diff: url.searchParams.get('diff') ?? undefined,
      lang: languageTag(url.searchParams.get('lang')) ?? undefined,
    });
  },
  tab: {
    kind: BLOCK_PANE,
    link: (_app, id) => {
      const placed = placedBlockOf(id);
      return placed === null
        ? null
        : blockLink({
            name: placed.name,
            copy: { projectId: placed.projectId, branch: placed.branch },
            diff: placed.diff ?? undefined,
            lang: placed.lang ?? undefined,
          });
    },
  },
};

const copies: LinkItems<BlockTarget> = {
  kind: BLOCK_LINK,
  order: 100,
  group: 'copies',
  acts: (app, link) => [
    {
      id: 'copy-name',
      words: 'Copy name',
      icon: Copy,
      run: () => navigator.clipboard.writeText(`[[${link.target.name}]]`),
    },
    {
      id: 'copy-link',
      words: 'Copy link',
      icon: Copy,
      run: async () => {
        const copy = await blockPlace(app, link.target);
        const href = copy === null ? null : knowledgeHref(app, link.target.name, copy);
        if (href !== null) await navigator.clipboard.writeText(new URL(href, app.resolve(Router).url).href);
      },
    },
  ],
};

const starts: LinkItems<BlockTarget> = {
  kind: BLOCK_LINK,
  order: 50,
  group: 'places',
  acts: (app, link) => {
    const here = app.resolve(GraphDoor).aim;
    const copy = link.target.copy ?? here;
    const name = blockAddress(link.target.name).name;
    const row = copy.projectId === here.projectId && copy.branch === here.branch ? app.resolve(ProjectTree).block(name) : undefined;
    if (row === undefined || !startable(app.resolve(TagCatalog), row)) return [];
    const work = app.resolve(ThreadWork);
    return [{ id: 'start-agent', words: START_WORDS, icon: Play, run: () => work.start({ name, title: row.title, copy }) }];
  },
};

export const links = [blocks];

export const items = [starts, copies];
