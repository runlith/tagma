<script lang="ts">
  import type { AccessRefusal } from '@tagma/server/remote/contract/wire/access';
  import Link from '@lucide/svelte/icons/link';
  import { Platform } from '@runlith/layer/Platform';
  import { Router } from '@runlith/layer/Router';
  import { machineName } from '$lib/features/shell/machine.js';
  import PairForm from './PairForm.svelte';

  let { refusal }: { refusal: AccessRefusal } = $props();

  const router = Router.use();
  const machine = machineName(Platform.use().storage.local);
</script>

<svelte:head><title>Pair with {machine}</title></svelte:head>

<div class="grid min-h-dvh place-items-center overflow-y-auto bg-background px-6 py-10 safe-top safe-bottom safe-x">
  <div class="grid w-full max-w-sm gap-6">
    <div class="grid justify-items-center gap-3 text-center">
      <span class="grid size-11 place-items-center rounded-full bg-sunken text-muted-foreground">
        <Link class="size-4" />
      </span>
      {#if refusal === 'device-revoked'}
        <h1 class="text-page font-semibold">This device was removed from {machine}</h1>
        <p class="text-body text-muted-foreground">
          To use Tagma here again, pair it with a new code from Settings → Phone &amp; devices on {machine}.
        </p>
      {:else}
        <h1 class="text-page font-semibold">Pair with {machine}</h1>
        <p class="text-body text-muted-foreground">
          On {machine}, open Settings → Phone &amp; devices, then scan the code with your camera or type it here.
        </p>
      {/if}
    </div>
    <PairForm {machine} onpaired={() => router.load('/', { replace: true })} />
  </div>
</div>
