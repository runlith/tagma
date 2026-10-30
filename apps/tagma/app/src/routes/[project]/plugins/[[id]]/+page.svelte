<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import PluginsPage from '$lib/features/plugins/PluginsPage.svelte';

  const router = Router.use();
  const opened = $derived(typeof router.params.id === 'string' && router.params.id !== '' ? router.params.id : null);
</script>

<PluginsPage {opened} />
