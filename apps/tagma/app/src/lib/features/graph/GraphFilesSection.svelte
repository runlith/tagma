<script lang="ts">
  import type { StorageMode } from '@tagma/server/projects/contract/wire/project';
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import { pick, rest, type SectionProps } from '$lib/features/settings/section.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let { catalog, scope, project }: SectionProps = $props();

  const tags = TagCatalog.use();
  const addresses = Addresses.use();
  const KEYS = ['graph.commit'];
  const entries = $derived(catalog.entriesOf('graph'));
  const storage = $derived(project?.storage ?? null);
  const unreadable = $derived(tags.table.unreadable);

  const STORAGE_FACT: Record<StorageMode, string> = {
    team: "Team — the tree lives in the repository, on the branch it stands on. Stealth blocks live beside it in a tree versioned by Tagma's own git, which the repository never carries.",
    stealth: "Stealth — the tree is versioned by Tagma's own git, outside the repository.",
  };

  const commits = $derived(storage === 'team');
  const move = $derived(project === null ? null : `tagma project storage ${project.name} ${storage === 'team' ? 'stealth' : 'team'}`);

  let copied = $state(false);
  let fades: ReturnType<typeof setTimeout> | undefined;
  function copyMove(): void {
    if (move === null) return;
    void navigator.clipboard?.writeText(move);
    copied = true;
    clearTimeout(fades);
    fades = setTimeout(() => (copied = false), 1_200);
  }
  $effect(() => () => clearTimeout(fades));
</script>

<KeyCard title="Where the tree lives" entries={pick(entries, KEYS)} dimmed={commits ? [] : KEYS} {catalog} {scope} {project}>
  {#snippet fact()}
    <span class="min-w-0">
      {storage === null ? 'No project open.' : STORAGE_FACT[storage]}
      {#if !commits}
        Who commits it is decided only where it lives in the repository.
      {/if}
    </span>
  {/snippet}
  {#snippet act()}
    {#if move !== null}
      <Tooltip text="Copy the command that moves this project's tree">
        <button
          type="button"
          class="stamp flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          onclick={copyMove}
        >
          {move}
          {#if copied}
            <Check class="size-3 text-status-done" />
          {:else}
            <Copy class="size-3" />
          {/if}
        </button>
      </Tooltip>
    {/if}
  {/snippet}
</KeyCard>

{#if unreadable.length > 0}
  <section class="mt-6 overflow-hidden rounded-lg border border-destructive/40 bg-raised" aria-label="Unreadable tag declarations">
    <header class="border-b border-border px-3 py-3">
      <h3 class="text-ui font-semibold">Unreadable tag declarations</h3>
      <p class="mt-1 text-small text-muted-foreground">These nodes do not contribute a tag until each declaration is readable.</p>
    </header>
    {#each unreadable as entry (entry.name)}
      <div class="grid gap-1 border-t px-3 py-3 text-ui">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          {#if project === null}
            <span class="stamp text-foreground">{entry.name}</span>
          {:else}
            <a
              class="stamp text-foreground underline-offset-4 hover:underline"
              href={addresses.block(entry.name, { project: project.name })}
            >
              {entry.name}
            </a>
          {/if}
          {#if entry.id !== ''}<span class="stamp text-muted-foreground">#{entry.id}</span>{/if}
        </div>
        <p class="text-destructive">{entry.reason}</p>
      </div>
    {/each}
  </section>
{/if}

{#if rest(entries, KEYS).length > 0}
  <KeyCard title="Vocabulary" entries={rest(entries, KEYS)} {catalog} {scope} {project} />
{/if}
