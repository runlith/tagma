<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import { Host } from '@runlith/layer/Host';
  import { Overlay } from '@runlith/primitives/Overlay.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import { Cycle, Switcher } from './Cycle.svelte.js';
  import { stripCommandOf } from './keys.js';
  import { ProjectPrefetch } from './Prefetch.js';
  import { ProjectStrip } from './Strip.svelte.js';

  let { cycling }: { cycling: () => void } = $props();

  const SWITCHER_AFTER_MS = 120;

  const host = Host.use();
  const strip = ProjectStrip.use();
  const prefetch = ProjectPrefetch.use();
  const workspace = Workspace.use();
  const overlay = Overlay.use();
  const shell = shellActs(ShellOps.use(), Notices.use());

  let cycle: Cycle | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function go(tile: Project | undefined): void {
    if (tile !== undefined && tile.id !== workspace.activeTileId) void shell.openProject(strip.entry(tile).id, 'keys');
  }

  function end(): Cycle | null {
    const held = cycle;
    cycle = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (overlay.isOpen(Switcher)) overlay.close(Switcher);
    return held;
  }

  function press(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const command = stripCommandOf(event, host.os, cycle !== null);
    if (command === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (command.kind === 'cancel') {
      end();
      return;
    }
    if (command.kind === 'go') {
      go(end()?.chosen);
      return;
    }
    if (cycle === null) {
      const projects = strip.cycle;
      if (projects.length < 2) return;
      const started = new Cycle(projects);
      cycle = started;
      cycling();
      timer = setTimeout(() => {
        timer = null;
        if (cycle === started) overlay.open(Switcher, { cycle: started });
      }, SWITCHER_AFTER_MS);
    }
    cycle.step(command.direction);
    prefetch.ahead(strip.entry(cycle.chosen));
  }

  $effect(() => {
    window.addEventListener('keydown', press, { capture: true });
    window.addEventListener('keyup', press, { capture: true });
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('keydown', press, { capture: true });
      window.removeEventListener('keyup', press, { capture: true });
      window.removeEventListener('blur', end);
      end();
    };
  });
</script>
