<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { BLOCK_REF } from '@tagma/server/graph/contract/wire/references';
  import { THREAD_REF } from '@tagma/server/threads/contract/wire/references';
  import { PROJECT_REF } from '@tagma/server/projects/contract/wire/references';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { type BlockRefView, blockRefView } from '$lib/features/graph/blockRefView.js';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import { blockLink } from '$lib/features/graph/links.js';
  import { threadRefView } from '$lib/features/graph/references.js';
  import type { Link, LinkFrom } from '$lib/features/opening/Link.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { PathLinks, type PathRoad } from '$lib/features/opening/PathLinks.js';
  import { pathMatches, type PathCode } from '$lib/features/opening/pathCode.js';
  import { commitMatches } from '$lib/features/checkout/commitCode.js';
  import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
  import { commitLink } from '$lib/features/checkout/links.js';

  const LINK = 'font-medium underline decoration-foreground/35 underline-offset-3 transition-colors hover:decoration-foreground/80';

  type Part =
    | { kind: 'text'; value: string }
    | { kind: 'ref'; name: string; view: BlockRefView }
    | { kind: 'project'; text: string; href: string | null }
    | { kind: 'thread'; text: string; href: string | null; link: Link | null }
    | { kind: 'path'; text: string; code: PathCode }
    | { kind: 'commit'; text: string; href: string | null; link: Link | null };

  let { text, plain = false, paths, from }: { text: string; plain?: boolean; paths?: PathRoad; from?: LinkFrom } = $props();

  const blockTitles = BlockTitles.use();
  const commitLinks = CommitLinks.use();
  const threadNames = ThreadNames.use();
  const addresses = Addresses.use();
  const workspace = Workspace.find();
  const opening = Opening.use();
  const here = App.current();

  function commitPart(id: string): Part {
    const peer = commitLinks.peer(id);
    return peer == null || 'error' in peer
      ? { kind: 'commit', text: id, href: null, link: null }
      : {
          kind: 'commit',
          text: id,
          href: addresses.commit(peer.sha, peer.project),
          link: commitLink({ sha: peer.sha, project: peer.project, subject: peer.subject }, from),
        };
  }

  function threadPart(id: string, label: string | null): Part {
    return { kind: 'thread', ...threadRefView(addresses, id, label, threadNames.of(id), from) };
  }

  function projectPart(id: number, label: string | null): Part {
    const project = workspace?.find(id) ?? null;
    return {
      kind: 'project',
      text: label ?? (project === null ? `project ${id}` : labelOf(project)),
      href: project === null ? null : addresses.project(project.name),
    };
  }

  const parts = $derived.by(() => {
    const out: Part[] = [];
    let last = 0;
    const projects = [...text.matchAll(PROJECT_REF)].map((match) => ({
      index: match.index,
      raw: match[0],
      part: projectPart(Number(match[1]), match[2] ?? null),
    }));
    const refs = [...text.matchAll(BLOCK_REF), ...text.matchAll(THREAD_REF)].map((match) => {
      const target = (match[1] as string).toLowerCase();
      const label = match[2] ?? null;
      const part: Part = match[1]!.includes('-')
        ? threadPart(target, label)
        : { kind: 'ref', name: target, view: blockRefView(addresses, target, label, blockTitles.peer(target)) };
      return { index: match.index, raw: match[0], part };
    });
    const candidates = plain || paths === undefined ? [] : [...pathMatches(text)];
    const commits = plain ? [] : [...commitMatches(text)];
    const matches = [
      ...refs,
      ...projects,
      ...candidates.map((match) => ({ ...match, part: { kind: 'path', text: match.raw, code: match.code } as Part })),
      ...commits.map((match) => ({ ...match, part: null })),
    ].sort((a, b) => a.index - b.index);
    for (const match of matches) {
      if (match.index < last) continue;
      if (match.index > last) out.push({ kind: 'text', value: text.slice(last, match.index) });
      out.push(match.part ?? commitPart(match.raw));
      last = match.index + match.raw.length;
    }
    if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
    return out;
  });

  const links = $derived(new PathLinks(opening, plain || text.length === 0 ? undefined : paths, here));
  $effect(() => {
    const reading = links;
    return () => reading.close();
  });

  const target = (link: Link | null) => linkTarget(opening, () => link, here);
</script>

<span
  class="contents"
  data-open-paths={paths === undefined ? undefined : ''}
  {@attach links.attachment(parts.some((part) => part.kind === 'path'))}
>
  {#each parts as part, index (index)}
    {#if part.kind === 'text'}{part.value}{:else if part.kind === 'path'}<span
        data-path={part.code.path}
        data-line={part.code.line ?? undefined}
        data-column={part.code.column ?? undefined}>{part.text}</span
      >{:else if part.kind === 'commit'}{#if part.link === null}{part.text}{:else}<a
          href={part.href}
          class={LINK}
          {@attach target(part.link)}>{part.text}</a
        >{/if}{:else if part.kind === 'project'}{#if plain || part.href === null}{part.text}{:else}<a href={part.href} class={LINK}
          >{part.text}</a
        >{/if}{:else if part.kind === 'thread'}{#if plain || part.link === null}{part.text}{:else}<a
          href={part.href}
          class={LINK}
          {@attach target(part.link)}>{part.text}</a
        >{/if}{:else if plain}{part.view.text}{:else if part.view.dead}<Tooltip text={part.view.title ?? undefined}
        ><span class={LINK} data-dead>{part.view.text}</span></Tooltip
      >{:else}<a
        href={part.view.href}
        role={part.view.href === null ? 'link' : undefined}
        tabindex={part.view.href === null ? 0 : undefined}
        class={LINK}
        {@attach target(blockLink({ name: part.name }, from))}>{part.view.text}</a
      >{/if}
  {/each}
</span>
