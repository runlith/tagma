<script lang="ts">
  import Group from '$lib/features/settings/Group.svelte';
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { toldOf } from '$lib/wire/refusal.js';

  let { catalog, scope, project }: SectionProps = $props();

  const settings = SettingsRepo.use();
  const read = $derived(project === null || scope !== 'project' ? undefined : settings.config.key(project.id));
  const config = $derived(read?.data?.config);
  const failed = $derived(read?.error ?? null);
</script>

<KeyCard entries={catalog.entriesOf('writing')} {catalog} {scope} {project} />

{#if config !== undefined || failed !== null}
  <Group title="Format">
    <div class="grid gap-1 py-3 text-ui text-muted-foreground" data-format>
      {#if failed !== null}
        <p>Format could not be read: {toldOf(failed).text}</p>
      {:else if config === null || config === undefined}
        <p>No tagma.config.ts at HEAD: commits land as they are written.</p>
      {:else if config.format.length === 0}
        <p>tagma.config.ts declares no format commands: commits land as they are written.</p>
      {:else}
        <p>Every commit Tagma lands runs these commands from tagma.config.ts, in order:</p>
        {#each config.format as command (command.key)}
          <p class="flex min-w-0 items-baseline gap-2">
            <span class="shrink-0 text-foreground">{command.key}</span>
            <FadeText class="min-w-0 flex-1 font-mono text-small" text={`${command.run.join(' ')} · ${command.files.join(', ')}`} />
          </p>
        {/each}
      {/if}
    </div>
  </Group>
{/if}
