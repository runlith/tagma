<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Surface from './Surface.svelte';
  import { Recorder, scroller } from './recorder';
  import type { Rig } from './rig.svelte';
  import type { ComposerStandPort } from './port';
  import { premeasure } from './premeasure';
  import { PageActions } from './PageActions';
  import { pagingMargin } from '@reach';

  let { rig, touch }: { rig: Rig; touch: boolean } = $props();
  let epoch = $state(0);
  onMount(() => {
    const observations = rig.observations;
    let timing = false;
    let recorder = new Recorder(observations, { timing });
    const actions = new PageActions(() => recorder, observations, pagingMargin);
    const port: ComposerStandPort = {
      ready: false,
      timing: () => {
        recorder.timing();
        timing = true;
      },
      point: () => actions.point(),
      targets: () => recorder.targets(),
      scrollbar: () => actions.scrollbar(),
      position: (top) => actions.position(top),
      approach: (distance) => actions.approach(distance, async () => rig.paging.requested),
      positionDisclosure: (side) => actions.positionDisclosure(side),
      disclosurePoint: () => actions.disclosurePoint(),
      beginDrag: (distance, speed, preventFling, quantum) => {
        actions.input();
        recorder.beginDrag(distance, speed, preventFling, quantum);
      },
      endDrag: () => recorder.endDrag(),
      beginWheel: () => {
        actions.input();
        recorder.beginWheel();
      },
      endWheel: () => recorder.endWheel(),
      pressed: () => recorder.pressed(),
      released: () => recorder.released(),
      landed: () => recorder.landed(),
      remount: async () => {
        recorder.dispose();
        epoch += 1;
        await tick();
        recorder = new Recorder(observations, { timing });
        recorder.start('open-tail');
      },
      warm: async (reach) => {
        recorder.start('control-warmup');
        const control = await premeasure(recorder, reach);
        recorder.stop();
        return control;
      },
      start: (name) => {
        actions.start(async () => rig.paging.requested);
        recorder.start(name);
      },
      stop: () => recorder.stop(),
      frames: (count) => recorder.frames(count),
      frameTime: () => recorder.frameTime(),
      stream: (chunks) => rig.stream(chunks),
      send: () => rig.turns.run(rig.turns.send(), false),
      sending: () => rig.turns.pending,
      loadOlder: () => actions.loadOlder(async () => rig.paging.requested),
      reachOlder: () => actions.reachOlder(),
      pageLatency: (ms) => rig.pageLatency(ms),
      holdPages: () => rig.holdPages(),
      releasePages: () => rig.releasePages(),
      paging: () => ({ ...rig.paging }),
      resize: async (width, height) => {
        recorder.changed();
        const host = document.getElementById('stand')!;
        host.style.width = `${width}px`;
        host.style.height = `${height}px`;
        await tick();
        await recorder.frames(2);
      },
      changed: () => recorder.changed(),
      state: () => ({ top: scroller().scrollTop, height: scroller().scrollHeight, viewport: scroller().clientHeight }),
    };
    window.feedStand = port;
    void document.fonts.ready
      .then(() => recorder.frames(4))
      .then(() => {
        port.ready = true;
      });
    return () => {
      recorder.dispose();
      delete window.feedStand;
    };
  });
</script>

{#key epoch}<Surface {rig} {touch} />{/key}
