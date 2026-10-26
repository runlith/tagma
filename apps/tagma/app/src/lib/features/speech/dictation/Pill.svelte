<script lang="ts">
  import type { DesktopDictation, Stroke } from '@tagma/desktop/bridge';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { untrack } from 'svelte';
  import { Host } from '@runlith/layer/Host';
  import { Router } from '@runlith/layer/Router';
  import type { SettingsPage } from '@tagma/server/platform/contract/wire/refusal';
  import { MainWindow } from '$lib/shared/desktop/MainWindow.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import { spellChord } from '$lib/shared/chordSpelling.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { toldLine } from '$lib/wire/told.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { Dictation } from './Dictation.svelte.js';
  import Meter from './Meter.svelte';
  import { PillTarget } from './pill.svelte.js';

  let { desktop }: { desktop: DesktopDictation } = $props();

  const LINGER_MS = 3_200;
  const MISSED = 'Not pasted — the text is on the clipboard';
  const apple = Host.use().apple;
  const paste = spellChord({ key: 'V', meta: apple, ctrl: !apple, alt: false, shift: false }, apple);

  const dictation = Dictation.use();
  const notices = Notices.use();
  const main = MainWindow.find();
  const router = Router.use();
  const target = untrack(() => new PillTarget(desktop));

  type Said = { readonly key: string; readonly lastAt: number; readonly text: string; readonly settings?: SettingsPage };

  let pressedAt = $state(0);
  let told: Said | null = null;
  let note = $state<string | null>(null);
  let pasteable = $state(false);

  const recording = $derived(dictation.target === target);
  const active = $derived(recording || target.pasting !== '');
  const visible = $derived(active || note !== null);
  const latest = $derived.by((): Said | null => {
    if (pressedAt === 0) return null;
    const said: Said[] = [
      ...notices.faults.map((fault) => ({ key: fault.key, lastAt: fault.lastAt, text: fault.body })),
      ...notices.list.flatMap((notice) =>
        notice.told === undefined
          ? []
          : [{ key: `notice:${notice.id}`, lastAt: notice.lastAt, text: toldLine(notice.told), settings: notice.told.settings }],
      ),
    ];
    return said
      .filter((one) => one.lastAt >= pressedAt)
      .reduce<Said | null>((found, one) => (found === null || one.lastAt > found.lastAt ? one : found), null);
  });

  function stroke(stroke: Stroke): void {
    if (stroke === 'press') {
      if (dictation.phase === 'idle') {
        pressedAt = Date.now();
        note = null;
        pasteable = false;
      }
      dictation.press(target, false);
    } else if (stroke === 'lift') {
      dictation.lift(false);
    } else if (dictation.target === target) {
      dictation.cancel();
    }
  }

  function lose(reason: string): void {
    if (dictation.target !== target) return;
    const heard = [dictation.stable, dictation.guess].filter((part) => part !== '').join(' ');
    if (heard !== '') desktop.keep(heard);
    pasteable = heard !== '';
    dictation.drop(target, heard === '' ? `${reason}.` : `${reason}. What was heard is on the clipboard.`);
  }

  $effect(() => {
    document.body.classList.add('bg-transparent');
    const stopStrokes = desktop.onStroke(stroke);
    const stopLost = desktop.onLost(lose);
    desktop.ready();
    return () => {
      stopStrokes();
      stopLost();
    };
  });

  $effect(() => desktop.show(visible));

  $effect(() => {
    const said = latest;
    if (said === null || (said.key === told?.key && said.lastAt === told.lastAt)) return;
    told = said;
    note = said.text;
    if (said.settings !== undefined) main?.reveal(settingsHref(router, 'speech'));
  });

  $effect(() => {
    if (!target.missed) return;
    note = MISSED;
    pasteable = true;
  });

  $effect(() => {
    if (active || note === null) return;
    const timer = setTimeout(() => (note = null), LINGER_MS);
    return () => clearTimeout(timer);
  });
</script>

<div class="flex h-screen items-center justify-center px-2">
  {#if visible}
    <div
      class="flex h-10 w-full min-w-0 items-center gap-2 rounded-full border border-border bg-popover px-4 text-popover-foreground shadow-float"
      role="status"
      aria-live="polite"
    >
      {#if recording}
        <span class="flex shrink-0 items-center gap-1.5"><Meter /></span>
        <p class="flex min-w-0 flex-1 justify-end overflow-hidden whitespace-nowrap text-ui">
          {#if dictation.stable === '' && dictation.guess === ''}
            <span class="text-muted-foreground">Speak — release to type where the cursor is</span>
          {:else}
            <span>{dictation.stable}</span>
            {#if dictation.guess !== ''}<span class="pl-1 text-muted-foreground">{dictation.guess}</span>{/if}
          {/if}
        </p>
      {:else if target.pasting !== ''}
        <Waiting class="size-3.5 text-muted-foreground" />
        <p class="flex min-w-0 flex-1 justify-end overflow-hidden whitespace-nowrap text-ui">{target.pasting}</p>
      {:else}
        <FadeText class="min-w-0 flex-1 text-ui" text={note ?? ''} />
        {#if pasteable}
          <span class="flex shrink-0 items-center gap-1.5 text-small text-muted-foreground"><Kbd chord={paste} size="sm" />pastes it</span>
        {/if}
      {/if}
    </div>
  {/if}
</div>
