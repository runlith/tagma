<script lang="ts">
  import { Host } from '@runlith/layer/Host';
  import { Platform } from '@runlith/layer/Platform';
  import { Router } from '@runlith/layer/Router';
  import { ServiceWorkers } from '$lib/shared/workers/ServiceWorkers.js';
  import { chooseShell, SHELL_CHOICES, storedShell, type ShellChoice } from './shell.js';

  const LABEL: Record<ShellChoice, { readonly title: string; readonly detail: string }> = {
    automatic: { title: 'Automatic', detail: 'Phone layout on a touch screen, desktop layout otherwise' },
    mobile: { title: 'Phone', detail: 'One screen at a time, sized for touch' },
    desktop: { title: 'Desktop', detail: 'Rail, side panes and every surface' },
  };

  const storage = Platform.use().storage.local;
  const workers = ServiceWorkers.use();
  const router = Router.use();
  const chosen = storedShell(storage);
  const touch = Host.use().touch;
</script>

<div role="radiogroup" aria-label="Layout" class="overflow-hidden rounded-lg border bg-raised">
  {#each SHELL_CHOICES as choice, index (choice)}
    <label
      class="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-hover pointer-coarse:min-h-12 pointer-coarse:px-4 pointer-coarse:py-3"
      class:border-t={index > 0}
    >
      <input
        type="radio"
        name="shell"
        class="size-4 shrink-0 accent-primary"
        checked={choice === chosen}
        onchange={() => void chooseShell(storage, workers, router, choice, touch)}
      />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-ui font-medium pointer-coarse:text-body">{LABEL[choice].title}</span>
        <span class="text-small text-muted-foreground pointer-coarse:text-ui">{LABEL[choice].detail}</span>
      </span>
    </label>
  {/each}
</div>
