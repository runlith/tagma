<script lang="ts">
  import { chordId, type HostChord } from '@tagma/server/platform/contract/wire/chord';
  import { Host } from '@runlith/layer/Host';
  import { Router } from '@runlith/layer/Router';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { rebindHref } from '$lib/features/shortcuts/href.js';
  import { Shortcuts } from '$lib/features/shortcuts/Shortcuts.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';

  let { plugin }: { plugin: string } = $props();

  const shortcuts = Shortcuts.use();
  const keymap = Keymap.use();
  const host = Host.use();
  const router = Router.use();

  const displaced = $derived(shortcuts.displacedOf(plugin));
  const offered = $derived(host.isDesktop ? shortcuts.offeredOf(plugin) : []);

  let taken = $state<{ readonly action: string; readonly chord: HostChord; readonly by: string } | null>(null);

  const holderTitle = (by: { readonly kind: 'shell' } | { readonly kind: 'action'; readonly action: string }): string =>
    by.kind === 'shell' ? (host.isDesktop ? 'Tagma itself' : 'your browser') : shortcuts.titleOf(by.action);

  function everywhere(action: string, chord: HostChord): void {
    const holder = shortcuts.holder(action, chord, true);
    if (holder === null) void shortcuts.everywhere(action, chord, true);
    else if (holder.kind === 'action') taken = { action, chord, by: shortcuts.titleOf(holder.action) };
  }

  function useHere(): void {
    const move = taken;
    taken = null;
    if (move !== null) void shortcuts.take(move.action, move.chord, true, 'add');
  }
</script>

{#if displaced.length > 0 || offered.length > 0}
  <section class="grid gap-2" aria-label="Shortcuts" data-plugin-keys={plugin}>
    <h3 class="text-small font-medium text-muted-foreground">Shortcuts</h3>
    <div class="grid divide-y rounded-lg border bg-raised">
      {#each displaced as one (`${one.action} ${chordId(one.chord)}`)}
        <div class="flex min-w-0 items-center gap-2 px-3 py-2 text-small" data-displaced={one.action}>
          <span class="min-w-0 flex-1 text-muted-foreground">
            <Kbd chord={keymap.spellChord(one.chord)} size="sm" /> for “{shortcuts.titleOf(one.action)}” is taken by {holderTitle(one.by)}.
          </span>
          <Button variant="outline" size="xs" onclick={() => void router.goto(rebindHref(router, one.action))}>Rebind</Button>
        </div>
      {/each}
      {#each offered as one (`${one.action} ${chordId(one.chord)}`)}
        <div class="flex min-w-0 items-center gap-2 px-3 py-2 text-small" data-offered={one.allowed ? 'allowed' : 'asked'}>
          <span class="min-w-0 flex-1 text-muted-foreground">
            {#if one.allowed}
              <Kbd chord={keymap.spellChord(one.chord)} size="sm" /> runs “{one.title}” in every app.
            {:else}
              <Kbd chord={keymap.spellChord(one.chord)} size="sm" /> runs “{one.title}” in Tagma; the plugin offers it in every app.
            {/if}
          </span>
          {#if one.allowed}
            <Button variant="outline" size="xs" onclick={() => void shortcuts.everywhere(one.action, one.chord, false)}
              >Only in Tagma</Button
            >
          {:else}
            <Button variant="outline" size="xs" onclick={() => everywhere(one.action, one.chord)}>Work in every app</Button>
          {/if}
        </div>
      {/each}
      {#if taken !== null}
        <div class="flex min-w-0 items-center gap-2 px-3 py-2 text-small text-muted-foreground" data-taken>
          <span class="flex-1"><Kbd chord={keymap.spellChord(taken.chord)} size="sm" /> runs {taken.by}.</span>
          <Button variant="outline" size="xs" onclick={useHere}>Use here</Button>
          <Button variant="ghost" size="xs" onclick={() => (taken = null)}>Cancel</Button>
        </div>
      {/if}
    </div>
  </section>
{/if}
