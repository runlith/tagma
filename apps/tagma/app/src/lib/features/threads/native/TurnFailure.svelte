<script lang="ts">
  import KeyRound from '@lucide/svelte/icons/key-round';
  import LogIn from '@lucide/svelte/icons/log-in';
  import FailureRow from '@runlith/chat-ui/FailureRow.svelte';
  import { failureFacts, failureRaw } from '@runlith/chat-ui/failureFacts';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import { Router } from '@runlith/layer/Router';
  import { NEED_WORDS } from '$lib/features/providers/accounts/status.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { providerName } from '$lib/features/providers/served.js';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { failureNeed, failureTitle } from './runEndingLine.js';

  let { entry }: { entry: ChatEntryOf<'error'> } = $props();

  const catalog = ProviderCatalog.use();
  const router = Router.use();

  const diagnostics = $derived(entry.diagnostics);
  const title = $derived(failureTitle(catalog.models, diagnostics));
  const need = $derived(failureNeed(catalog.models, diagnostics));
  const provider = $derived(diagnostics.provider === null ? null : providerName(catalog.models, diagnostics.provider));
</script>

<article data-message-id={entry.id} class="mr-auto w-full min-w-0 max-w-feed">
  <FailureRow
    id={entry.id}
    label={title ?? 'The turn broke before finishing'}
    text={diagnostics.reason?.said ?? (title === null ? entry.text : null)}
    facts={failureFacts(diagnostics, provider)}
    raw={failureRaw(entry.text, diagnostics)}
    occurredAt={entry.occurredAt}
  >
    {#snippet actions()}
      {#if need !== null}
        <Button variant="outline" size="xs" onclick={() => void router.goto(settingsHref(router, 'providers'))}>
          {#if need === 'new-key'}<KeyRound class="size-3" />{:else}<LogIn class="size-3" />{/if}{NEED_WORDS[need]}
        </Button>
      {/if}
    {/snippet}
  </FailureRow>
</article>
