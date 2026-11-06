<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
  import MessagesSquare from '@lucide/svelte/icons/messages-square';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import MatchText from '$lib/shared/MatchText.svelte';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import type { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import type { ActionEnv } from '$lib/features/workspace/action.js';
  import type { Row } from '$lib/features/palette/Palette.svelte.js';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import PulseMarks from '$lib/features/projects/PulseMarks.svelte';
  import Swatch from '$lib/features/workspace/Swatch.svelte';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { conversationLabel } from '$lib/features/threads/conversationLabel.js';
  import Spans from '$lib/shared/Spans.svelte';
  import { timeCompact } from '$lib/shared/time.js';
  import * as Command from '$lib/shared/ui/command/index.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';

  let {
    row,
    tags,
    projectId,
    env,
    onSelect,
  }: { row: Row; tags: TagCatalog | null; projectId: number | null; env: ActionEnv; onSelect: () => void } = $props();

  const keymap = Keymap.use();

  const disabled = $derived(row.kind === 'action' && (row.action.disabled?.(env) ?? false));

  const twoLines = $derived(row.kind === 'thread' || row.kind === 'commit' || (row.kind === 'block' && row.hit.snippet !== ''));
</script>

<Command.Item value={row.value} {disabled} {onSelect} class={['gap-2 px-3 py-1.5', twoLines && 'items-start']} data-palette-row={row.kind}>
  {#if row.kind === 'project'}
    <Swatch projectId={row.project.id} />
    <FadeText class="flex-1"><MatchText text={labelOf(row.project)} positions={row.positions} /></FadeText>
    <PulseMarks projectId={row.project.id} />
    {#if row.project.id === projectId}<span class="stamp shrink-0 text-muted-foreground">current</span>{/if}
  {:else if row.kind === 'file'}
    {@const hit = row.hit}
    <FileIcon path={hit.path} />
    <PathText path={hit.path} directory="after" class="flex-1" directoryClass="text-small text-muted-foreground">
      {#snippet piece(from, to)}<MatchText text={hit.path} positions={hit.positions} {from} {to} />{/snippet}
    </PathText>
    {#if row.line !== null}
      <span class="stamp shrink-0 text-muted-foreground">:{row.line}{row.column === null ? '' : `:${row.column}`}</span>
    {/if}
  {:else if row.kind === 'thread'}
    {@const elsewhere = row.hit.project !== null && row.hit.project.id !== projectId ? row.hit.project : null}
    <MessagesSquare class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    <div class="min-w-0 flex-1">
      <div data-line class="items-baseline gap-2">
        <FadeText text={conversationLabel(row.hit)} />
        {#if elsewhere !== null}<span class="stamp text-muted-foreground" data-palette-project>{elsewhere.name}</span>{/if}
        {#if row.hit.archived}<span class="eyebrow text-muted-foreground">Archived</span>{/if}
      </div>
      <FadeText class="text-small text-muted-foreground">
        <Spans text={row.hit.match.snippet} spans={row.hit.match.highlights} />
      </FadeText>
    </div>
    <span class="stamp tabular shrink-0 text-muted-foreground">{timeCompact(row.hit.match.occurredAt)}</span>
  {:else if row.kind === 'block'}
    <TagIcon
      tag={tags?.tagOf(row.hit) ?? null}
      class={twoLines ? 'mt-0.5 size-3.5 shrink-0 text-muted-foreground' : 'size-3.5 shrink-0 text-muted-foreground'}
    />
    <div class="min-w-0 flex-1">
      <FadeText text={row.hit.title.trim() || 'Untitled'} />
      {#if row.hit.snippet}
        <FadeText class="text-small text-muted-foreground" text={row.hit.snippet} />
      {/if}
    </div>
    <span class="flex shrink-0 items-center gap-1.5">
      <span class="size-2 rounded-full" style:background={tags?.statusVar(row.hit)}></span>
    </span>
  {:else if row.kind === 'commit'}
    <GitCommitHorizontal class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    <div class="min-w-0 flex-1">
      <FadeText text={row.commit.subject} />
      <FadeText class="text-small text-muted-foreground">
        <span class="stamp">{row.commit.sha.slice(0, 7)}</span> · {row.commit.author}
      </FadeText>
    </div>
    <span class="stamp tabular shrink-0 text-muted-foreground">{timeCompact(row.commit.date)}</span>
  {:else if row.kind === 'setting'}
    <Settings2 class="size-3.5 shrink-0 text-muted-foreground" />
    <span data-line class="flex-1 items-baseline gap-2">
      <FadeText><MatchText text={row.entry.title} positions={row.positions} /></FadeText>
      <FadeText data-yield class="stamp text-muted-foreground" text={row.entry.id} />
    </span>
  {:else if row.kind === 'action'}
    {@const Icon = row.action.icon ?? ChevronRight}
    {@const note = row.action.note?.(env) ?? null}
    {@const chord = keymap.spell(row.action.id)}
    <Icon class="size-3.5 shrink-0 text-muted-foreground" />
    <FadeText class="flex-1"><MatchText text={row.action.title} positions={row.positions} /></FadeText>
    {#if note !== null}<span class="stamp shrink-0 text-muted-foreground">{note}</span>{/if}
    {#if chord !== null}<Kbd {chord} size="sm" />{/if}
  {:else}
    <Sparkles class="size-3.5 shrink-0 text-brand" />
    <span class="shrink-0">Ask Tagma</span>
    <FadeText class="flex-1 text-muted-foreground" text={`“${row.text}”`} />
    <Kbd chord={keymap.spellText('Mod+Enter')} size="sm" />
  {/if}
</Command.Item>
