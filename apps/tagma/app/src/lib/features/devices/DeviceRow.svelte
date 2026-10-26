<script lang="ts">
  import type { Device } from '@tagma/server/remote/contract/wire/access';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { timeAgo } from '$lib/shared/time.js';

  let {
    device,
    current,
    notified,
    removing,
    now,
    onremove,
  }: {
    device: Device;
    current: boolean;
    notified: boolean;
    removing: boolean;
    now: number;
    onremove: () => void;
  } = $props();

  function ago(iso: string): string {
    const said = timeAgo(iso, now);
    if (said === 'now') return 'just now';
    return /^\d+[mhd]$/.test(said) ? `${said} ago` : `on ${said}`;
  }
</script>

<li class="flex items-center gap-3 px-3 py-2 pointer-coarse:min-h-12 pointer-coarse:px-4 pointer-coarse:py-3">
  <Smartphone class="size-4 shrink-0 text-muted-foreground" />
  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
    <span class="truncate text-ui font-medium pointer-coarse:text-body">
      {device.name}
      {#if current}<span class="font-normal text-muted-foreground"> · this device</span>{/if}
    </span>
    <span class="truncate text-small text-muted-foreground">
      Paired {ago(device.pairedAt)}
      {#if device.lastSeenAt !== null}
        · seen {ago(device.lastSeenAt)}{/if}
      {#if notified}
        · notifications on{/if}
    </span>
  </div>
  {#if !current}
    <Button variant="destructive" size="sm" class="pointer-coarse:h-11 pointer-coarse:px-4" disabled={removing} onclick={onremove}>
      {removing ? 'Removing…' : 'Remove'}
    </Button>
  {/if}
</li>
