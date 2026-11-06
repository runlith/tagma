<script lang="ts">
  import FileSearch from '@lucide/svelte/icons/file-search';
  import { Overlay } from '@runlith/primitives/Overlay.svelte';
  import { Palette } from '$lib/app/panes/palette.js';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';

  const overlay = Overlay.use();
  const keymap = Keymap.use();
</script>

<DropdownMenu.Item
  icon={FileSearch}
  keys={keymap.spell('palette.files')}
  onSelect={() => overlay.open(Palette, { group: 'files', beside: true })}
>
  File…
</DropdownMenu.Item>
