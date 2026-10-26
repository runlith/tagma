<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import CallsPage from '$lib/features/speech/library/CallsPage.svelte';

  const router = Router.use();
  const opened = $derived(typeof router.params.id === 'string' && router.params.id !== '' ? router.params.id : null);
  const at = $derived(router.url.searchParams.get('at'));
  const word = $derived.by(() => {
    const given = Number(router.url.searchParams.get('word') ?? Number.NaN);
    return Number.isFinite(given) ? given : null;
  });
</script>

<CallsPage {opened} {at} {word} />
