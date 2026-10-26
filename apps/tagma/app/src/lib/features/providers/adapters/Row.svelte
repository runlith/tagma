<script lang="ts">
  import Power from '@lucide/svelte/icons/power';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { AdapterState } from '@tagma/server/providers/contract/wire/catalog';
  import { Dialogs } from '@runlith/primitives/DialogRegistry.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { AdaptersRepo } from './AdaptersRepo.js';
  import RemoveDialog from './RemoveDialog.svelte';

  let { adapter }: { adapter: AdapterState } = $props();

  const dialogs = Dialogs.use();
  const notices = Notices.use();
  const adapters = AdaptersRepo.use();

  const managed = $derived(adapter.origin === 'machine' && adapter.source !== undefined);
  const version = $derived(adapter.version === null ? '' : `@${adapter.version}`);
  const dot = $derived(
    adapter.state === 'loaded' ? 'bg-status-done' : adapter.state === 'failed' ? 'bg-destructive' : 'border border-vein-strong',
  );
  const word = $derived(adapter.state === 'loaded' ? 'Loaded' : adapter.state === 'failed' ? 'Failed' : 'Disabled');

  let busy = $state<'update' | 'switch' | 'remove' | null>(null);

  async function act(mark: 'update' | 'switch' | 'remove', work: () => Promise<unknown>): Promise<void> {
    busy = mark;
    try {
      await work();
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      busy = null;
    }
  }

  const update = () => act('update', () => adapters.update.run(adapter.id, { throwOnError: true }));

  const toggle = () =>
    act('switch', () =>
      adapter.state === 'disabled'
        ? adapters.enable.run(adapter.id, { throwOnError: true })
        : adapters.disable.run(adapter.id, { throwOnError: true }),
    );

  function confirmRemove(): void {
    const handle = dialogs.open(RemoveDialog, {
      id: adapter.id,
      onCancel: () => handle.close(),
      onConfirm: () => {
        handle.close();
        void act('remove', () => adapters.remove.run(adapter.id, { throwOnError: true }));
      },
    });
  }
</script>

<div class="grid gap-1 border-t border-border px-3 py-2" data-adapter-row={adapter.id} data-adapter-state={adapter.state}>
  <div class="flex items-center gap-2">
    <span class={['size-2 shrink-0 rounded-full', dot]}></span>
    <span class="min-w-0 truncate font-mono text-ui">{adapter.id}{version}</span>
    <span class="text-ui text-muted-foreground">{word}</span>
    <span class="flex-1"></span>
    {#if !managed}
      {#if adapter.origin === 'builtin'}
        <span class="text-ui text-muted-foreground">Built in</span>
      {/if}
    {:else}
      <Tooltip text="Install again from its source; runs that started keep the version they began with">
        <Button variant="ghost" size="xs" disabled={busy !== null} onclick={update}>
          <RefreshCw class="size-3" />
          {busy === 'update' ? 'Updating…' : 'Update'}
        </Button>
      </Tooltip>
      <Tooltip text={adapter.state === 'disabled' ? 'Load this adapter again' : 'Stop loading this adapter; its accounts and keys stay'}>
        <Button variant="ghost" size="xs" disabled={busy !== null} onclick={toggle}>
          <Power class="size-3" />
          {adapter.state === 'disabled' ? 'Enable' : 'Disable'}
        </Button>
      </Tooltip>
      <Tooltip text="Remove this adapter from the machine">
        <Button variant="ghost" size="icon-xs" aria-label="Remove {adapter.id}" disabled={busy !== null} onclick={confirmRemove}>
          <Trash2 class="size-3" />
        </Button>
      </Tooltip>
    {/if}
  </div>
  {#if adapter.state === 'loaded'}
    <p class="pl-4 text-small text-muted-foreground">Serves {adapter.providers.join(', ') || 'no provider'}</p>
  {:else if adapter.state === 'failed'}
    <p class="pl-4 text-small text-destructive" role="alert">{adapter.reason}</p>
  {/if}
  {#if adapter.source !== undefined}
    <p class="truncate pl-4 font-mono text-meta text-muted-foreground/80" title={adapter.source}>{adapter.source}</p>
  {/if}
</div>
