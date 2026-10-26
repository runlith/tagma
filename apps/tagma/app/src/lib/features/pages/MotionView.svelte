<script lang="ts">
  import Maximize from '@lucide/svelte/icons/maximize';
  import Minimize from '@lucide/svelte/icons/minimize';
  import Repeat from '@lucide/svelte/icons/repeat';
  import type { Timeline } from '@tagma/server/artifacts/contract/wire/timeline';
  import { type Snippet, untrack } from 'svelte';
  import Transport from '$lib/shared/Transport.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import Frame, { type FrameProtocol } from '../views/Frame.svelte';
  import { MotionPlayer } from './MotionPlayer.svelte.js';
  import { PAGE_SANDBOX_FLAGS } from '@tagma/server/artifacts/contract/wire/policy';
  import { motionWidth } from './sizing.js';

  type Props = {
    src: string;
    title: string;
    timeline: Timeline;
    fill?: boolean;
    actions?: Snippet<[MotionPlayer]>;
  };

  let { src, title, timeline, fill = false, actions }: Props = $props();

  const player = new MotionPlayer(
    untrack(() => timeline),
    true,
  );
  const protocol: FrameProtocol = (target) => player.attach(target);

  let stage = $state<HTMLElement | null>(null);
  let full = $state(false);

  const spread = $derived(fill || full);
  const width = $derived(motionWidth(timeline));

  const clock = (seconds: number): string => {
    const whole = Math.floor(seconds);
    const hundredths = String(Math.floor((seconds - whole) * 100 + 1e-6)).padStart(2, '0');
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${hundredths}`;
  };

  $effect(() => () => player.close());

  $effect(() => {
    const changed = () => (full = stage !== null && document.fullscreenElement === stage);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  });

  function screen(): void {
    if (stage === null) return;
    if (document.fullscreenElement === stage) void document.exitFullscreen();
    else void stage.requestFullscreen();
  }
</script>

<div bind:this={stage} class={['flex min-w-0 flex-col', spread && 'h-full', full && 'bg-background']} data-motion>
  <div
    class={['relative', spread ? 'min-h-0 flex-1' : 'max-w-full']}
    style:aspect-ratio={spread ? undefined : `${timeline.width} / ${timeline.height}`}
    style:width={spread ? undefined : width}
  >
    <Frame {src} {title} sandbox={PAGE_SANDBOX_FLAGS} {protocol} fill inert class="border-0 bg-transparent" />
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      aria-label={player.playing ? 'Pause' : 'Play'}
      onclick={() => player.toggle()}
      ondblclick={screen}
    ></button>
  </div>
  <div class="px-1 pt-1">
    <Transport
      playing={player.playing}
      disabled={!player.ready}
      time={`${clock(player.seconds)} / ${clock(player.length)}`}
      toggle={() => player.toggle()}
      step={(direction) => player.step(direction)}
      region={stage}
    >
      <input
        type="range"
        class="min-w-0 flex-1 accent-primary"
        min="0"
        max={player.frames - 1}
        step="1"
        value={player.at}
        disabled={!player.ready}
        aria-label="Frame"
        aria-valuetext={`Frame ${player.at + 1} of ${player.frames}`}
        oninput={(event) => player.seek(event.currentTarget.valueAsNumber)}
      />
      <Tooltip text={player.loop ? 'Play once' : 'Play in a loop'}>
        <Button
          variant="ghost"
          size="icon-sm"
          class={player.loop ? undefined : 'text-muted-foreground'}
          aria-label="Loop"
          aria-pressed={player.loop}
          onclick={() => player.repeat()}
        >
          <Repeat class="size-3.5" />
        </Button>
      </Tooltip>
      {@render actions?.(player)}
      {#if document.fullscreenEnabled}
        <Tooltip text={full ? 'Leave full screen' : 'Full screen'}>
          <Button variant="ghost" size="icon-sm" aria-label={full ? 'Leave full screen' : 'Full screen'} onclick={screen}>
            {#if full}<Minimize class="size-3.5" />{:else}<Maximize class="size-3.5" />{/if}
          </Button>
        </Tooltip>
      {/if}
    </Transport>
    {#if player.failure !== null}
      <p class="px-2 pb-1 text-small text-destructive">The page could not draw frame {player.failure.k + 1}: {player.failure.reason}</p>
    {/if}
  </div>
</div>
