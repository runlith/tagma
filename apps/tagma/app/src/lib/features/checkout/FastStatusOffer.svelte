<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { offersFastStatus, untrackedCache } from '@tagma/server/workspace/contract/wire/settings';
  import Button from '$lib/shared/ui/button/button.svelte';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';

  let { projectId, slowStatus }: { projectId: number; slowStatus: boolean } = $props();

  const settings = SettingsRepo.use();
  const marks = ReaderMarks.use();

  let writing = $state(false);
  let problem = $state<string | null>(null);

  const markedAt = $derived(`${untrackedCache.id}:${projectId}`);

  const on = $derived.by(() => {
    if (!slowStatus) return undefined;
    const value = settings.catalog.key(projectId).data?.entries.find((entry) => entry.id === untrackedCache.id)?.value;
    return typeof value === 'boolean' ? value : undefined;
  });

  const shown = $derived(offersFastStatus({ slowStatus }, on, marks.declinedOffers.get(markedAt) === true));

  async function turnOn(): Promise<void> {
    writing = true;
    problem = null;
    try {
      await settings.write.run({ projectId, scope: 'project', key: untrackedCache.id, value: true }, { throwOnError: true });
      await settings.catalog.key(projectId).refresh({ throwOnError: true });
    } catch (caught) {
      problem = caught instanceof Error ? caught.message : String(caught);
    } finally {
      writing = false;
    }
  }
</script>

{#if shown}
  <div class="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-small text-muted-foreground" data-fast-status-offer>
    <span class="min-w-0 flex-1">
      {problem ?? 'git status is slow in this repository. The untracked cache makes it reread only the directories that changed.'}
    </span>
    <Button size="sm" variant="outline" class="h-6 px-2 text-small" disabled={writing} onclick={turnOn}>Turn on</Button>
    <button
      type="button"
      class="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground"
      aria-label="Dismiss"
      onclick={() => marks.declinedOffers.set(markedAt, true)}
    >
      <X class="size-3" />
    </button>
  </div>
{/if}
