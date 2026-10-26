<script lang="ts">
  import type { PairedAnswer } from '@tagma/server/remote/contract/wire/access';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { onMount, untrack } from 'svelte';
  import { Platform } from '@runlith/layer/Platform';
  import { rememberMachine, sentenceStart } from '$lib/features/shell/machine.js';
  import { Door } from '$lib/wire/Door.js';
  import { Refusal } from '$lib/wire/refusal.js';
  import { pair } from './pair.js';

  let {
    machine,
    code: offered = '',
    onpaired,
  }: {
    machine: string;
    code?: string;
    onpaired: (answer: PairedAnswer) => void;
  } = $props();

  const door = Door.use();
  const storage = Platform.use().storage.local;
  let code = $state(untrack(() => offered));
  let pairing = $state(false);
  let problem = $state<string | null>(null);
  let field = $state<HTMLInputElement | null>(null);

  function told(caught: unknown): string {
    const refusal = caught instanceof Refusal ? caught : null;
    switch (refusal?.code) {
      case 'pairing-refused':
        return `That code isn't the one ${machine} shows now, or it has expired.`;
      case 'pairing-throttled':
        return 'Too many wrong codes. Wait a few minutes, then try again.';
      case 'remote-off':
        return `${sentenceStart(machine)} isn't accepting phones right now. Turn on access in Settings → Phone & devices there.`;
      case 'origin-refused':
        return `This page didn't come from ${machine}'s address. Scan the code again.`;
      case 'transport':
        return `Can't reach ${machine}.`;
      default:
        return refusal?.reason ?? (caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function submit(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    if (pairing || code.trim() === '') return;
    pairing = true;
    problem = null;
    try {
      const answer = await pair(door, code.trim());
      rememberMachine(storage, answer.machine);
      onpaired(answer);
    } catch (caught) {
      problem = told(caught);
      field?.select();
    } finally {
      pairing = false;
    }
  }

  onMount(() => {
    if (code !== '') void submit();
    else field?.focus();
  });
</script>

<form class="grid gap-3" onsubmit={(event) => void submit(event)}>
  <label class="grid gap-1.5">
    <span class="text-small font-medium text-muted-foreground">Pairing code</span>
    <input
      bind:this={field}
      bind:value={code}
      class="h-12 rounded-md border bg-field px-3 text-center font-mono text-title outline-none focus-visible:ring-2 focus-visible:ring-ring"
      placeholder="XXXX-XXXX"
      autocomplete="one-time-code"
      autocapitalize="characters"
      autocorrect="off"
      spellcheck="false"
      enterkeyhint="go"
      maxlength={12}
      disabled={pairing}
      aria-invalid={problem !== null}
    />
  </label>
  {#if problem !== null}
    <p class="text-ui text-destructive" role="alert">{problem}</p>
  {/if}
  <button
    type="submit"
    class="flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-body font-medium text-primary-foreground active:opacity-90 disabled:opacity-50"
    disabled={pairing || code.trim() === ''}
  >
    {#if pairing}
      <Waiting class="size-4" />
      Pairing…
    {:else}
      Pair
    {/if}
  </button>
</form>
