<script lang="ts">
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import JournalPage from '$lib/features/graph/journal/Page.svelte';
  import { JournalScreen } from '$lib/features/graph/journal/Screen.svelte.js';
  import { Topics } from '$lib/shared/threads/Topics.svelte.js';

  const journal = JournalScreen.mount();
  const topics = Topics.use();
  const addresses = Addresses.use();

  const scope = $derived(addresses.scope);

  $effect(() => {
    void journal.selection;
    journal.readAt(scope);
  });

  $effect(() => topics.offer(() => ({ kind: 'text', text: `About the journal${scope === null ? '' : ` of ${scope}`}: ` })));
</script>

<JournalPage {journal} {scope} />
