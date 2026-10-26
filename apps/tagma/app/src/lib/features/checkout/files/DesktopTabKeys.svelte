<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { DesktopTabs } from '$lib/shared/desktop/DesktopTabs.js';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { CHECKOUT, SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import { Tabs } from './Tabs.svelte.js';

  const tabs = Tabs.use();
  const keymap = Keymap.use();
  const panes = SidePanes.use();
  const desktop = DesktopTabs.find();
  const router = Router.use();
  const surfaces = SurfaceRegistry.use();

  $effect(() => {
    if (desktop === undefined) return;
    return desktop.onCommand((command) => {
      if (keymap.press(command === 'reopen' ? keymap.mod('KeyT', { shift: true }) : keymap.mod('KeyW'), null)) return;
      const here = surfaces.of(router.routeId) === CHECKOUT;
      if (command === 'reopen') {
        if (here) tabs.reopen();
        return;
      }
      const beside = panes.focus;
      if (beside !== null) {
        panes.close(beside);
        return;
      }
      const file = here ? tabs.active : null;
      if (file !== null) {
        tabs.close(file.id);
        return;
      }
      const shown = panes.showing ? panes.active : null;
      if (shown !== null) panes.close(shown.key);
      else desktop.closeWindow();
    });
  });
</script>
