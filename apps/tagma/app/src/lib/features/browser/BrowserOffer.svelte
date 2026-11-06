<script lang="ts">
  import Globe from '@lucide/svelte/icons/globe';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { browserPane } from './panes.js';

  const panes = SidePanes.use();
  const keymap = Keymap.use();
</script>

<DropdownMenu.Item icon={Globe} keys={keymap.spell('browser.open')} onSelect={() => panes.open(browserPane(null))}>
  Browser page
</DropdownMenu.Item>
