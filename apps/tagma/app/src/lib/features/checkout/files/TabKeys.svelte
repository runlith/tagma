<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { TAB_CLOSE, TAB_REOPEN } from '$lib/features/workspace/action.js';
  import { CHECKOUT, SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import { Tabs } from './Tabs.svelte.js';

  const tabs = Tabs.use();
  const keymap = Keymap.use();
  const panes = SidePanes.use();
  const router = Router.use();
  const surfaces = SurfaceRegistry.use();

  const here = (): boolean => surfaces.of(router.routeId, router.params) === CHECKOUT;

  $effect(() => {
    const closing = keymap.handle(TAB_CLOSE, () => {
      const file = panes.focus === null && here() ? tabs.active : null;
      if (file === null) return false;
      tabs.close(file.id);
      return true;
    });
    const reopening = keymap.handle(TAB_REOPEN, () => {
      if (!here()) return false;
      tabs.reopen();
      return true;
    });
    return () => {
      closing();
      reopening();
    };
  });
</script>
