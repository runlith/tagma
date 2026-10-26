<script lang="ts">
  import '../app.css';
  import Root from '$lib/app/Root.svelte';

  let { data, children } = $props();
</script>

<Root Shell={data.Shell} refusal={data.refusal}>{@render children()}</Root>
