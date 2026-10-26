<script lang="ts">
  import type { PairedAnswer } from '@tagma/server/remote/contract/wire/access';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Share from '@lucide/svelte/icons/share';
  import { untrack } from 'svelte';
  import { Host } from '@runlith/layer/Host';
  import { Platform } from '@runlith/layer/Platform';
  import { Router } from '@runlith/layer/Router';
  import { machineName } from '$lib/features/shell/machine.js';
  import PairForm from './PairForm.svelte';

  type InstallPrompt = Event & { prompt(): Promise<void> };

  const host = Host.use();
  const phone = host.kind === 'mobile';
  const installed = host.installed;
  const ios = host.os === 'ios';

  const router = Router.use();
  const machine = machineName(Platform.use().storage.local);

  const code = decodeURIComponent(router.url.hash.slice(1));
  $effect(() => untrack(() => void router.replace(router.pathname)));

  let paired = $state<PairedAnswer | null>(null);
  let install = $state<InstallPrompt | null>(null);

  $effect(() => {
    const offered = (event: Event): void => {
      event.preventDefault();
      install = event as InstallPrompt;
    };
    window.addEventListener('beforeinstallprompt', offered);
    return () => window.removeEventListener('beforeinstallprompt', offered);
  });

  function done(answer: PairedAnswer): void {
    if (installed || !phone) router.load('/', { replace: true });
    else paired = answer;
  }

  async function installApp(prompt: InstallPrompt): Promise<void> {
    await prompt.prompt();
    install = null;
  }
</script>

<svelte:head><title>Pair with Tagma</title></svelte:head>

<div class="grid min-h-dvh place-items-center overflow-y-auto bg-background px-6 py-10 safe-top safe-bottom safe-x">
  <div class="grid w-full max-w-sm gap-6">
    {#if paired === null}
      <div class="grid justify-items-center gap-2 text-center">
        <h1 class="text-page font-semibold">Pair this phone</h1>
        <p class="text-body text-muted-foreground">
          The code is in Settings → Phone &amp; devices on {machine}.
        </p>
      </div>
      <PairForm {machine} {code} onpaired={done} />
    {:else}
      <div class="grid justify-items-center gap-3 text-center">
        <CircleCheck class="size-4 text-status-done" />
        <h1 class="text-page font-semibold">Paired with {paired.machine}</h1>
        {#if ios}
          <p class="text-body text-muted-foreground">
            Add Tagma to your Home Screen: tap
            <Share class="inline size-4 align-text-bottom" aria-label="Share" />
            then Add to Home Screen, and open it from there.
          </p>
        {:else if install !== null}
          <p class="text-body text-muted-foreground">Install Tagma to open it like an app.</p>
        {:else}
          <p class="text-body text-muted-foreground">Choose Install app in the browser menu to open Tagma like an app.</p>
        {/if}
      </div>
      <div class="grid gap-2">
        {#if install !== null}
          {@const prompt = install}
          <button
            type="button"
            class="flex h-11 items-center justify-center rounded-md bg-primary px-4 text-body font-medium text-primary-foreground active:opacity-90"
            onclick={() => void installApp(prompt)}
          >
            Install
          </button>
        {/if}
        <a
          href="/"
          class="flex h-11 items-center justify-center rounded-md px-4 text-body font-medium text-foreground active:bg-hover"
          data-sveltekit-reload
        >
          Continue in the browser
        </a>
      </div>
    {/if}
  </div>
</div>
