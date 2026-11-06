<script lang="ts">
  import SunMoon from '@lucide/svelte/icons/sun-moon';
  import { TAGMA_THEME } from '@tagma/server/appearance/contract/wire/format';
  import type { AppearanceMode } from '@tagma/server/appearance/contract/wire/settings';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { Appearance } from './Appearance.svelte.js';
  import { MODE_LABEL, MODES } from './words.js';

  const appearance = Appearance.use();
</script>

<DropdownMenu.Sub>
  <DropdownMenu.SubTrigger icon={SunMoon} current={appearance.title}>Theme</DropdownMenu.SubTrigger>
  <DropdownMenu.SubContent class="min-w-44">
    <DropdownMenu.RadioGroup value={appearance.chosen} onValueChange={(next) => appearance.chooseTheme(next)}>
      <DropdownMenu.RadioItem value={TAGMA_THEME} closeOnSelect={false}>Tagma</DropdownMenu.RadioItem>
      {#each appearance.offered as offered (offered.id)}
        <DropdownMenu.RadioItem value={offered.id} closeOnSelect={false}>{offered.theme.title}</DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
    <DropdownMenu.Separator />
    {#if appearance.onlyLook !== null}
      <DropdownMenu.Note text="{appearance.title} comes only in {appearance.onlyLook}" />
    {:else}
      <DropdownMenu.RadioGroup value={appearance.choice} onValueChange={(next) => appearance.chooseMode(next as AppearanceMode)}>
        {#each MODES as mode (mode)}
          <DropdownMenu.RadioItem value={mode} closeOnSelect={false}>{MODE_LABEL[mode]}</DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    {/if}
  </DropdownMenu.SubContent>
</DropdownMenu.Sub>
