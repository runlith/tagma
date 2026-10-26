<script lang="ts">
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { checkoutName } from './checkoutName.js';

  let {
    checkout,
    project,
    class: extra,
  }: {
    checkout: { readonly projectId: number | null; readonly branch: string | null; readonly root: string };
    project: boolean;
    class?: string;
  } = $props();

  const workspace = Workspace.use();
  const named = $derived(project && checkout.projectId !== null ? (workspace.find(checkout.projectId)?.name ?? null) : null);
  const text = $derived(named === null ? checkoutName(checkout) : `${named} · ${checkoutName(checkout)}`);
</script>

<FadeText class={extra} {text} />
