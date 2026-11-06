<script lang="ts">
  import { chordId, type HostChord } from '@tagma/server/platform/contract/wire/chord';
  import { Host } from '@runlith/layer/Host';
  import { Router } from '@runlith/layer/Router';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { rebindHref } from '$lib/features/shortcuts/href.js';
  import { Shortcuts, type Taken } from '$lib/features/shortcuts/Shortcuts.svelte.js';
  import TakenLine from '$lib/features/shortcuts/TakenLine.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';

  let { plugin }: { plugin: string } = $props();

  const shortcuts = Shortcuts.use();
  const keymap = Keymap.use();
  const host = Host.use();
  const router = Router.use();

  const displaced = $derived(shortcuts.displacedOf(plugin));
  const offered = $derived(host.isDesktop ? shortcuts.offeredOf(plugin) : []);

  let taken = $state<Taken | null>(null);

  function grant(action: string, chord: HostChord, global: boolean): void {
    taken = shortcuts.ask({ action, chord, global, mode: 'grant' });
  }

  const rebind = (action: string): void => void router.goto(rebindHref(router, action));
</script>

{#if displaced.length > 0 || offered.length > 0}
  <section class="grid gap-2" aria-label="Shortcuts" data-plugin-keys={plugin}>
    <h3 class="text-small font-medium text-muted-foreground">Shortcuts</h3>
    <div class="grid divide-y rounded-lg border bg-raised">
      {#each displaced as one (`${one.action} ${chordId(one.chord)}`)}
        <div class="flex min-w-0 items-center gap-2 px-3 py-2 text-small" data-displaced={one.action}>
          <span class="min-w-0 flex-1 text-muted-foreground">
            <Kbd chord={keymap.spellChord(one.chord)} size="sm" /> for “{shortcuts.titleOf(one.action)}” is taken by {shortcuts.holderTitle(
              one.by,
            )}.
          </span>
          <Button variant="outline" size="xs" onclick={() => rebind(one.action)}>Rebind</Button>
        </div>
      {/each}
      {#each offered as one (`${one.action} ${chordId(one.chord)}`)}
        {@const refused = one.answer?.grant === 'taken' || one.answer?.grant === 'unavailable'}
        <div
          class="flex min-w-0 items-center gap-2 px-3 py-2 text-small"
          data-offered={!one.allowed ? 'asked' : refused ? 'refused' : 'allowed'}
        >
          <span class="min-w-0 flex-1 text-muted-foreground">
            {#if !one.allowed}
              <Kbd chord={keymap.spellChord(one.chord)} size="sm" /> runs “{one.title}” in Tagma; the plugin offers it in every app.
            {:else if one.answer?.grant === 'taken'}
              Another app holds <Kbd chord={keymap.spellChord(one.chord)} size="sm" />, so “{one.title}” runs only in Tagma.
            {:else if one.answer?.grant === 'unavailable'}
              <Kbd chord={keymap.spellChord(one.chord)} size="sm" /> for “{one.title}”: {one.answer.reason ??
                'this chord cannot work in every app here'}.
            {:else}
              <Kbd chord={keymap.spellChord(one.chord)} size="sm" /> runs “{one.title}” in every app.
            {/if}
          </span>
          {#if !one.allowed}
            <Button variant="outline" size="xs" onclick={() => grant(one.action, one.chord, true)}>Work in every app</Button>
          {:else if refused}
            <Button variant="outline" size="xs" onclick={() => rebind(one.action)}>Rebind</Button>
          {:else}
            <Button variant="outline" size="xs" onclick={() => grant(one.action, one.chord, false)}>Only in Tagma</Button>
          {/if}
        </div>
      {/each}
      {#if taken !== null}
        <TakenLine {taken} size="xs" class="px-3 py-2" onclose={() => (taken = null)} />
      {/if}
    </div>
  </section>
{/if}
