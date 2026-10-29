<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import SectionPage from '$lib/features/tagma-apps/SectionPage.svelte';

  const router = Router.use();
</script>

<SectionPage tagmaApp={router.params.app ?? ''} view={router.params.view ?? ''} />
