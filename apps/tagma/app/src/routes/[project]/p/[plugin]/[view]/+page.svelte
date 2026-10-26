<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import SectionPage from '$lib/features/plugins/SectionPage.svelte';

  const router = Router.use();
</script>

<SectionPage plugin={router.params.plugin ?? ''} view={router.params.view ?? ''} />
