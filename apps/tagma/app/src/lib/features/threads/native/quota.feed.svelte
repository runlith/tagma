<script lang="ts">
  import { NO_FACTS } from '@runlith/chat-ui/EntryKinds.svelte';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import { signedWords } from '$lib/features/providers/usage/spendWords.js';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';

  let { kinds, contributor }: { kinds: EntryKinds; contributor: string } = $props();

  const accounts = UsageAccounts.use();
  const catalog = ProviderCatalog.use();

  $effect.pre(() =>
    kinds.register(contributor, {
      kind: 'signal',
      facts: (entry) =>
        entry.keptWarm?.account === undefined
          ? NO_FACTS
          : [{ label: 'quota', value: signedWords(catalog.models, entry.keptWarm.account, accounts.rows) }],
    }),
  );
</script>
