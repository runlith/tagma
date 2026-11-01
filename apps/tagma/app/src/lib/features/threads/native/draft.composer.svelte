<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { CHAT_DRAFT_ATTACH_ACCEPT } from '@runlith/chat-ui/draftFiles';
  import type { ComposerMentionOption } from '@runlith/chat-ui/composer';
  import DraftAttachmentStrip from '@runlith/chat-ui/DraftAttachmentStrip.svelte';
  import StagedCards from './StagedCards.svelte';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import { mentionedProject } from '@tagma/server/projects/contract/wire/references';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import Swatch from '$lib/features/workspace/Swatch.svelte';
  import ProjectMark from '$lib/features/workspace/ProjectMark.svelte';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { isThreadId } from '../activityIdentity.js';
  import AgentIcon from '$lib/shared/AgentIcon.svelte';
  import type { DraftMention, ThreadDraft } from '../Draft.svelte.js';
  import ThreadLife, { threadMark } from '../Life.svelte';
  import { ThreadList } from '../List.svelte.js';
  import { MentionDrops, type MentionZone } from '../MentionDrops.svelte.js';
  import MentionSlot from '../MentionSlot.svelte';
  import type { ShownThread } from '../ShownThread.js';
  import type { ComposerFeeds } from './ComposerFeeds.svelte.js';
  import type { SlotSurface } from './contribution.js';
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';

  let {
    shown,
    draft,
    feeds,
    composer,
    surface,
    contributor,
  }: {
    shown: ShownThread;
    draft: ThreadDraft;
    feeds: ComposerFeeds;
    composer: ComposerContributions;
    surface: SlotSurface;
    contributor: string;
  } = $props();

  const CHIP = 'flex min-w-0 max-w-72 items-center gap-1.5 rounded-lg border py-1 text-small';

  const list = ThreadList.use();
  const names = ThreadNames.use();
  const drops = MentionDrops.use();
  const workspace = Workspace.use();
  const zoneId = $props.id();
  const zone: MentionZone = {
    covers: (under) => {
      const frame = under.closest('[data-composer-frame]');
      return frame !== null && (surface.element?.contains(frame) ?? false);
    },
    own: () => shown.id,
    holds: (name) => draft.mentions.some((mention) => mention.name === name),
    mention: (mentions) => {
      draft.stageMentions(mentions.map((mention) => ({ name: mention.name, title: mention.title, tag: null })));
      surface.prompt.focus();
    },
  };
  const dropState = $derived(drops.stateOf(zoneId, zone));
  const incoming = $derived(dropState === null ? [] : drops.fresh(zone));

  function titleOf(threadId: string, fallback: string): string {
    return names.of(threadId)?.label.trim() || fallback;
  }

  function projectTitle(projectId: number, fallback: string): string {
    const project = workspace.find(projectId);
    return project === null ? fallback.trim() || `project ${projectId}` : labelOf(project);
  }

  $effect.pre(() => {
    const disposers = [
      composer.chip(contributor, { id: 'media', region: 'media', body: media }),
      composer.mention(contributor, {
        id: 'blocks',
        prefix: '@',
        get label() {
          return feeds.label;
        },
        options: () => feeds.mentions,
        icon: mentionIcon,
        search: (query) => feeds.search(query),
        pick: (id) => feeds.pick(id),
      }),
      composer.attachment(contributor, {
        id: 'files',
        accept: CHAT_DRAFT_ATTACH_ACCEPT,
        button: !surface.sheets,
        intake: (files) => feeds.attach(files),
      }),
      composer.drop(contributor, {
        id: 'threads',
        get state() {
          return dropState;
        },
      }),
      drops.add(zoneId, zone),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
</script>

{#snippet media()}
  {#if draft.mentions.length > 0 || dropState !== null}
    <div class="flex flex-wrap gap-1.5 pb-1">
      {#each draft.mentions as mention (mention.name)}
        {@const project = mentionedProject(mention.name)}
        {#if isThreadId(mention.name)}
          {@render threadChip(mention)}
        {:else if project !== null}
          <span class={[CHIP, 'bg-raised pr-1 pl-2']} data-mention-project={project}>
            <Swatch projectId={project} />
            <FadeText text={projectTitle(project, mention.title)} />
            {@render remove(mention)}
          </span>
        {:else}
          <span class={[CHIP, 'bg-raised pr-1 pl-2']}>
            <TagIcon tag={mention.tag} class="size-3.5 shrink-0 text-muted-foreground" />
            <FadeText text={mention.title.trim() || 'Untitled'} />
            {@render remove(mention)}
          </span>
        {/if}
      {/each}
      {#if dropState !== null}<MentionSlot state={dropState} {incoming} />{/if}
    </div>
  {/if}
  <StagedCards {draft} />
  <DraftAttachmentStrip images={draft.images} files={draft.files} onRemove={(id) => draft.removeAttachment(id)} />
{/snippet}

{#snippet threadChip(mention: DraftMention)}
  {@const row = list.row(mention.name)}
  {@const home = names.of(mention.name)?.projectId}
  <span class={[CHIP, 'bg-raised pr-1 pl-2']} data-mention-thread={mention.name}>
    <AgentIcon class="size-3.5 shrink-0 text-muted-foreground" />
    <FadeText text={titleOf(mention.name, mention.title.trim() || 'Untitled')} />
    {#if row !== undefined && threadMark(row).state !== 'quiet'}<ThreadLife thread={row} />{/if}
    {#if home !== undefined && home !== shown.projectId}<span class="flex max-w-24 shrink-0"
        ><ProjectMark projectId={home} class="min-w-0" /></span
      >{/if}
    {@render remove(mention)}
  </span>
{/snippet}

{#snippet remove(mention: DraftMention)}
  <Tooltip text="Remove mention">
    <button
      type="button"
      class="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      aria-label="Remove mention"
      onclick={() => draft.removeMention(mention.name)}
    >
      <X class="size-3" />
    </button>
  </Tooltip>
{/snippet}

{#snippet mentionIcon(option: ComposerMentionOption)}
  <TagIcon tag={feeds.tagOf(option.id)} class="size-4 shrink-0 text-muted-foreground" />
{/snippet}
