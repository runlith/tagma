<script lang="ts" module>
  export type MarkdownSize = 'body' | 'ui' | 'small';
</script>

<script lang="ts">
  import { fallbackBlock, type MarkdownHtml } from '@runlith/markdown/render';
  import { getAllContexts, untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { type BlockRefs, blockRefView } from '$lib/features/graph/blockRefView.js';
  import type { SettingChips } from '$lib/features/settings/chips/SettingChips.svelte.js';
  import { commitAnchors } from '$lib/features/checkout/commitAnchors.js';
  import type { CommitLookup } from '$lib/features/checkout/CommitLinks.svelte.js';
  import { commitLink } from '$lib/features/checkout/links.js';
  import type { Link, LinkFrom } from '$lib/features/opening/Link.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { PathLinks, type PathRoad } from '$lib/features/opening/PathLinks.js';
  import { renderBody } from '$lib/features/graph/markdown.js';
  import { threadRefView } from '$lib/features/graph/references.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import type { OwnerWords } from '$lib/shared/threads/Names.svelte.js';
  import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
  import { blockLink } from './links.js';

  let {
    text,
    size = 'body',
    class: className = '',
    cacheKey,
    streaming = false,
    refs,
    commits,
    settings,
    threadOf,
    paths,
    from,
    onRendered,
  }: {
    text: string;
    size?: MarkdownSize;
    class?: string;
    cacheKey?: string;
    streaming?: boolean;
    refs?: BlockRefs;
    commits?: CommitLookup;
    settings?: SettingChips;
    threadOf?: (id: string) => OwnerWords | null | undefined;
    paths?: PathRoad | undefined;
    from?: LinkFrom | undefined;
    onRendered?: () => void;
  } = $props();

  const SIZES: Record<MarkdownSize, string> = {
    body: 'text-body leading-6',
    ui: 'text-ui leading-5',
    small: 'text-small leading-5',
  };

  const origin = ServerOrigin.use();
  const addresses = Addresses.use();
  const workspace = Workspace.find();
  const opening = Opening.use();
  const here = App.current();
  const contexts = getAllContexts();

  const linked = (element: HTMLElement, link: Link): (() => void) => {
    const release = linkTarget(opening, () => link, here)(element);
    return typeof release === 'function' ? release : () => undefined;
  };

  let settledText = $state<string>();
  const settled = $derived(!streaming && settledText === text);

  const pathLinks = $derived(new PathLinks(opening, streaming || settledText !== text ? undefined : paths, here));

  $effect(() => {
    const links = pathLinks;
    return () => links.close();
  });

  function settingChips(block: MarkdownHtml, held: SettingChips | undefined): Attachment<HTMLElement> {
    return (root) => {
      if (held === undefined || block.live || !block.html.includes('<code')) return;
      return held.attach(root, contexts);
    };
  }

  let blocks = $state.raw<MarkdownHtml[]>([]);
  let renderRevision = 0;

  $effect(() => {
    const source = text;
    const key = cacheKey;
    const live = streaming;
    const revision = ++renderRevision;
    if (!/\S/.test(source)) {
      blocks = [];
      return;
    }
    if (untrack(() => blocks.length === 0)) blocks = [fallbackBlock(source)];
    void (async () => {
      const next = await renderBody(source, { key, streaming: live }, origin, addresses);
      if (revision !== renderRevision) return;
      blocks = next;
      settledText = live ? undefined : source;
      onRendered?.();
    })();
  });

  function blockRefs(block: MarkdownHtml, resolver: BlockRefs | undefined): Attachment<HTMLElement> {
    return (root) => {
      if (!resolver || !block.html.includes('data-block-ref')) return;
      const releases: (() => void)[] = [];
      for (const anchor of root.querySelectorAll<HTMLElement>('a[data-block-ref]')) {
        const name = anchor.getAttribute('data-block-ref') ?? '';
        const labelled = anchor.hasAttribute('data-block-label');
        const peer = resolver.peer(name);
        const view = blockRefView(addresses, name, labelled ? (anchor.textContent ?? '') : null, peer);
        anchor.toggleAttribute('data-dead', view.dead);
        if (view.href === null) {
          anchor.removeAttribute('href');
          anchor.setAttribute('role', 'link');
          anchor.setAttribute('tabindex', '0');
        } else {
          anchor.setAttribute('href', view.href);
          anchor.removeAttribute('role');
          anchor.removeAttribute('tabindex');
        }
        if (!labelled) anchor.textContent = view.text;
        const told = view.dead || (peer != null && 'error' in peer) ? view.title : null;
        if (told === null) anchor.removeAttribute('title');
        else anchor.setAttribute('title', told);
        if (!view.dead) releases.push(linked(anchor, blockLink({ name }, from)));
      }
      return () => {
        for (const release of releases) release();
      };
    };
  }

  function projectRefs(block: MarkdownHtml): Attachment<HTMLElement> {
    return (root) => {
      if (workspace === undefined || !block.html.includes('data-project-ref')) return;
      for (const anchor of root.querySelectorAll('a[data-project-ref]')) {
        const project = workspace.find(Number(anchor.getAttribute('data-project-ref')));
        anchor.toggleAttribute('data-dead', project === null);
        if (project === null) anchor.removeAttribute('href');
        else anchor.setAttribute('href', addresses.project(project.name));
        if (project !== null && !anchor.hasAttribute('data-project-label')) anchor.textContent = labelOf(project);
      }
    };
  }

  function threadRefs(block: MarkdownHtml, resolve: ((id: string) => OwnerWords | null | undefined) | undefined): Attachment<HTMLElement> {
    return (root) => {
      if (!resolve || !block.html.includes('data-thread-ref')) return;
      const releases: (() => void)[] = [];
      for (const anchor of root.querySelectorAll<HTMLElement>('a[data-thread-ref]')) {
        const id = anchor.getAttribute('data-thread-ref') ?? '';
        const view = threadRefView(addresses, id, anchor.hasAttribute('data-thread-label') ? anchor.textContent : null, resolve(id), from);
        anchor.toggleAttribute('data-dead', view.dead);
        if (view.href === null) anchor.removeAttribute('href');
        else anchor.setAttribute('href', view.href);
        if (!anchor.hasAttribute('data-thread-label')) anchor.textContent = view.text;
        if (view.link !== null) releases.push(linked(anchor, view.link));
      }
      return () => {
        for (const release of releases) release();
      };
    };
  }

  function siteRefs(block: MarkdownHtml): Attachment<HTMLElement> {
    return (root) => {
      if (!block.html.includes('href="http')) return;
      const releases: (() => void)[] = [];
      for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')) {
        const link = opening.anchored(anchor.href, here);
        if (link !== null) releases.push(linked(anchor, { ...link, from }));
      }
      return () => {
        for (const release of releases) release();
      };
    };
  }
</script>

<div
  class={['markdown-body', SIZES[size], className]}
  data-size={size === 'body' ? undefined : 'compact'}
  data-open-paths={paths === undefined ? undefined : ''}
>
  {#each blocks as block (block.key)}
    <div
      class="markdown-block"
      {@attach blockRefs(block, refs)}
      {@attach threadRefs(block, threadOf)}
      {@attach projectRefs(block)}
      {@attach siteRefs(block)}
      {@attach settingChips(block, settings)}
      {@attach pathLinks.attachment(block.html.includes('data-path'))}
      {@attach commitAnchors(block.html.includes('data-commit') ? commits : undefined, addresses, settled, (anchor, peer) =>
        linked(anchor, commitLink({ sha: peer.sha, project: peer.project, subject: peer.subject }, from)),
      )}
    >
      {@html block.html}
    </div>
  {/each}
</div>
