<script lang="ts">
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Globe from '@lucide/svelte/icons/globe';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import X from '@lucide/svelte/icons/x';
  import { chordId, type HostChord } from '@tagma/server/platform/contract/wire/chord';
  import { Host } from '@runlith/layer/Host';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { DesktopDictation } from '$lib/shared/desktop/DesktopDictation.js';
  import { SystemSettings } from '$lib/shared/SystemSettings.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { notesOf } from './notes.js';
  import { Shortcuts, type Taken } from './Shortcuts.svelte.js';
  import TakenLine from './TakenLine.svelte';

  let { action, capturing = false }: { action: string; capturing?: boolean } = $props();

  const shortcuts = Shortcuts.use();
  const keymap = Keymap.use();
  const host = Host.use();
  const systemSettings = SystemSettings.find();
  const bridge = DesktopDictation.find();
  const allow =
    systemSettings === undefined
      ? null
      : () => {
          bridge?.prompt();
          systemSettings.open('accessibility');
        };

  const row = $derived(shortcuts.rowOf(action));
  const first = $derived(row?.bound[0] ?? null);
  const everywhere = $derived(host.isDesktop && row !== undefined && row.keyed.place === 'window');
  let mode = $state<'replace' | 'add' | null>(null);
  let taken = $state<Taken | null>(null);

  function grant(chord: HostChord, global: boolean): void {
    taken = shortcuts.ask({ action, chord, global, mode: 'grant' });
  }

  const notes = $derived(row === undefined ? [] : notesOf(row, shortcuts, keymap, host, grant, allow));

  $effect(() => {
    if (capturing) mode = 'replace';
  });

  $effect(() => {
    const capture = mode;
    if (capture === null) return;
    return keymap.capture((chord) => {
      mode = null;
      if (chord === null) return;
      taken = shortcuts.ask({ action, chord, global: capture === 'replace' && first?.global === true, mode: capture });
    });
  });
</script>

{#if row !== undefined}
  <div class="grid min-w-0 gap-1" data-chord-control={action}>
    <div class="flex min-w-0 items-center gap-1.5">
      {#if mode !== null}
        <span class="flex-1 text-small text-muted-foreground" data-capturing
          >Press the new chord… <Kbd chord={keymap.spellText('Escape')} size="sm" /> cancels</span
        >
      {:else}
        <span class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" data-chords>
          {#each row.bound as binding (chordId(binding.chord))}
            <Kbd chord={keymap.spellChord(binding.chord)} />
          {:else}
            <span class="text-small text-muted-foreground">No keys</span>
          {/each}
        </span>
      {/if}
      <Button variant="outline" size="sm" onclick={() => (mode = mode === null ? 'replace' : null)} data-rebind>Rebind</Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="flex size-7 items-center justify-center rounded-md hover:bg-hover" aria-label="More for this shortcut">
          <Ellipsis class="size-3.5" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-56">
          <DropdownMenu.Item icon={Plus} onSelect={() => (mode = 'add')}>Add a chord</DropdownMenu.Item>
          {#if everywhere && first !== null}
            <DropdownMenu.Item
              icon={Globe}
              onSelect={() => grant(first.chord, !first.global)}
              data-everywhere={first.global ? 'off' : 'on'}
            >
              {first.global ? 'Only in Tagma' : 'Work in every app'}
            </DropdownMenu.Item>
          {/if}
          {#if row.changed}
            <DropdownMenu.Item icon={RotateCcw} onSelect={() => void shortcuts.reset(action)}>Reset to default</DropdownMenu.Item>
          {/if}
          {#if row.bound.length > 0}
            <DropdownMenu.Separator />
            <DropdownMenu.Item icon={X} variant="destructive" onSelect={() => void shortcuts.remove(action)}>Remove keys</DropdownMenu.Item>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
    {#if taken !== null}
      <TakenLine {taken} onclose={() => (taken = null)} />
    {/if}
    {#each notes as note (note.key)}
      <p class="flex min-w-0 flex-wrap items-center gap-1.5 text-small text-muted-foreground" data-note={note.kind}>
        {#if note.chord !== null}<Kbd chord={note.chord} size="sm" class="opacity-60" />{/if}
        <span>{note.text}</span>
        {#if note.act !== null}
          <button type="button" class="underline-offset-4 hover:text-foreground hover:underline" onclick={note.act.run}
            >{note.act.label}</button
          >
        {/if}
      </p>
    {/each}
  </div>
{/if}
