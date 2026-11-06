<script lang="ts">
  import SunMoon from '@lucide/svelte/icons/sun-moon';
  import { APPEARANCE_MODES, type AppearanceMode, MODE_LABELS } from '@tagma/server/appearance/contract/wire/settings';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { Appearance } from './Appearance.svelte.js';

  const appearance = Appearance.use();
</script>

<DropdownMenu.Sub>
  <DropdownMenu.SubTrigger icon={SunMoon} current={appearance.title}>Theme</DropdownMenu.SubTrigger>
  <DropdownMenu.SubContent class="min-w-44">
    <DropdownMenu.RadioGroup value={appearance.chosen} onValueChange={(next) => appearance.chooseTheme(next)}>
      {#each appearance.themes as entry (entry.id)}
        <DropdownMenu.RadioItem value={entry.id} closeOnSelect={false}>{entry.title}</DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
    <DropdownMenu.Separator />
    {#if appearance.onlyLook !== null}
      <DropdownMenu.Note text="{appearance.title} comes only in {appearance.onlyLook}" />
    {:else}
      <DropdownMenu.RadioGroup value={appearance.choice} onValueChange={(next) => appearance.chooseMode(next as AppearanceMode)}>
        {#each APPEARANCE_MODES as mode (mode)}
          <DropdownMenu.RadioItem value={mode} closeOnSelect={false}>{MODE_LABELS[mode]}</DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    {/if}
  </DropdownMenu.SubContent>
</DropdownMenu.Sub>
