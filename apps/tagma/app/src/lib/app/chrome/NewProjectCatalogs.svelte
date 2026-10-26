<script lang="ts">
  import { graphCatalogs } from '@tagma/server/catalogs/contract/wire/settings';
  import { CORE_LIBRARY } from '@tagma/server/graph/contract/wire/tags/identity';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';

  type Props = { value?: readonly string[] | undefined };
  let { value = $bindable() }: Props = $props();

  const settings = SettingsRepo.use();
  const workspace = Workspace.use();

  const aim = $derived((workspace.projects.find((project) => project.global) ?? workspace.contextProject)?.id);
  const entry = $derived(aim === undefined ? undefined : settings.catalog.key(aim));

  const declared = $derived(entry?.data?.entries.find((row) => row.id === graphCatalogs.id));
  const failed = $derived(entry?.error !== undefined && declared === undefined);

  const offered = $derived.by(() => {
    const control = declared?.control;
    return control?.kind === 'choice' ? control.choices.filter((choice) => choice.value !== CORE_LIBRARY) : undefined;
  });

  const standing = $derived.by(() => {
    if (declared === undefined || offered === undefined) return undefined;
    const user = declared.layers.user?.value;
    const named = Array.isArray(user) ? user : declared.fallback;
    const defaults = Array.isArray(named) ? named.filter((id): id is string => typeof id === 'string') : [];
    return offered.map((choice) => choice.value).filter((id) => defaults.includes(id));
  });

  let touched = $state<readonly string[] | null>(null);
  const selected = $derived(touched ?? standing);

  $effect(() => {
    value = selected;
  });

  function toggle(id: string): void {
    const current = selected ?? [];
    touched = current.includes(id) ? current.filter((one) => one !== id) : [...current, id];
  }
</script>

<div class="grid gap-1.5" role="group" aria-label="Catalogs">
  <span class="eyebrow text-muted-foreground">Catalogs</span>
  {#if offered !== undefined && selected !== undefined && standing !== undefined}
    {#each offered as choice (choice.value)}
      <label class="flex cursor-pointer items-baseline gap-2 text-ui">
        <input type="checkbox" checked={selected.includes(choice.value)} onchange={() => toggle(choice.value)} />
        <span>
          <span class="font-medium">{choice.label}</span>
          {#if standing.includes(choice.value)}
            <span class="stamp text-muted-foreground/60">default</span>
          {/if}
          <span class="text-muted-foreground"> — {choice.hint}</span>
        </span>
      </label>
    {/each}
    <label class="flex cursor-pointer items-baseline gap-2 text-ui">
      <input type="radio" name="no-template" checked={selected.length === 0} onchange={() => (touched = [])} />
      <span>
        <span class="font-medium">No template</span>
        <span class="text-muted-foreground"> — only the system library ({CORE_LIBRARY}), which every project carries</span>
      </span>
    </label>
  {:else if failed}
    <div class="flex items-center gap-2 text-ui text-destructive" role="alert">
      <span class="min-w-0 flex-1">The catalog list could not be read, so the project cannot be created yet.</span>
      <Button size="sm" variant="outline" onclick={() => void entry?.refresh()}>Retry</Button>
    </div>
  {:else}
    <span class="text-ui text-muted-foreground">Reading the machine default…</span>
  {/if}
</div>
