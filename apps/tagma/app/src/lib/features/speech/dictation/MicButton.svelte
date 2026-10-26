<script lang="ts">
  import Mic from '@lucide/svelte/icons/mic';
  import MicOff from '@lucide/svelte/icons/mic-off';
  import { Host } from '@runlith/layer/Host';
  import { Router } from '@runlith/layer/Router';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { spellKey, spellModifier } from '$lib/shared/chordSpelling.js';
  import { SystemSettings } from '$lib/shared/SystemSettings.js';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import { SpeechRepo } from '../Repo.js';
  import { blocked } from './blocked.js';
  import { chordLabel } from './chord.js';
  import { Dictation } from './Dictation.svelte.js';
  import Meter from './Meter.svelte';
  import type { Target } from './target.js';

  let { target }: { target: Target } = $props();

  const dictation = Dictation.use();
  const speech = SpeechRepo.use();
  const router = Router.use();
  const apple = Host.use().apple;
  const systemSettings = SystemSettings.find();
  const status = $derived(speech.status.data);
  const stop = $derived(status === undefined ? null : blocked(status));
  const model = $derived(status?.dictation.kind === 'ready' ? ` · ${status.dictation.label}` : '');
  const mine = $derived(dictation.target === target);
  const busy = $derived(dictation.phase === 'recording' && !mine);
  const recording = $derived(mine && dictation.phase !== 'finishing');
  const hint = $derived.by(() => {
    if (mine) return recording ? 'Release to insert' : 'Confirming the last words';
    if (stop !== null) return `${stop.title} — ${stop.detail}`;
    return `Dictate${model}`;
  });
  const hints = $derived.by(() => {
    if (recording)
      return [
        { keys: spellModifier('shift', apple), words: 'on release sends' },
        { keys: spellKey('Escape', apple), words: 'cancels' },
      ];
    return mine || stop !== null ? [] : [{ keys: chordLabel(dictation.chord, apple), words: 'hold to speak' }];
  });

  let pressing = false;

  function down(event: PointerEvent): void {
    if (event.button !== 0 || stop !== null || busy) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pressing = true;
    dictation.press(target, event.shiftKey);
  }

  function up(event: PointerEvent): void {
    if (!pressing) return;
    pressing = false;
    dictation.lift(event.shiftKey);
  }

  function click(event: MouseEvent): void {
    if (stop?.settings !== undefined && systemSettings !== undefined) systemSettings.open(stop.settings);
    else if (stop !== null) void router.goto(settingsHref(router, 'speech'));
    else if (event.detail === 0 && !busy) dictation.toggle(target, event.shiftKey);
  }
</script>

<Tooltip text={hint} {hints}>
  <button
    type="button"
    class={[
      'flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full transition-colors disabled:opacity-50',
      mine ? 'bg-hover px-2' : 'w-7 hover:bg-hover',
      !mine && (stop === null ? 'text-muted-foreground' : 'text-destructive'),
    ]}
    aria-label={mine ? 'Stop dictation' : stop === null ? 'Dictate' : stop.title}
    aria-pressed={mine}
    disabled={busy}
    onpointerdown={down}
    onpointerup={up}
    onpointercancel={up}
    onclick={click}
  >
    {#if mine}
      <Meter />
    {:else if stop === null}
      <Mic class="size-4" />
    {:else}
      <MicOff class="size-4" />
    {/if}
  </button>
</Tooltip>
