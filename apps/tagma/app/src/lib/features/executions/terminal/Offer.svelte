<script lang="ts">
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import TerminalIcon from '../TerminalIcon.svelte';
  import { Terminals } from '../worktrees/Terminals.svelte.js';

  const terminals = Terminals.use();
</script>

<DropdownMenu.Item icon={TerminalIcon} onSelect={() => void terminals.openBeside()}>Terminal</DropdownMenu.Item>
