<script lang="ts">
  import RunEndingStrip from '@runlith/chat-ui/RunEndingStrip.svelte';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
  import { SignInFlow, pendingWords } from '$lib/features/providers/SignInFlow.svelte.js';
  import SignInTerminal from '$lib/features/providers/SignInTerminal.svelte';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import type { ComposerPart } from '../native/contribution.js';

  let { shown, birth, panel, composer, contributor }: ComposerPart = $props();

  const workspace = Workspace.use();
  let provider = $state('');
  const flow = new SignInFlow(AccountsRepo.use(), Notices.use(), ExternalLinks.use(), () => provider);

  const signedOut = $derived(shown.id === null ? birth.settings.signedOut : null);
  const showing = $derived(signedOut !== null);
  const pending = $derived(flow.pending);
  const failed = $derived(flow.outcome?.kind === 'failed' ? flow.outcome : null);

  $effect(() => () => flow.dispose());

  $effect.pre(() => (showing ? composer.chip(contributor, { id: 'signed-out', region: 'dock', body: notice }) : undefined));

  function signIn(): void {
    if (signedOut === null) return;
    provider = signedOut.provider;
    void flow.begin(workspace.find(shown.projectId), undefined, signedOut.account);
  }
</script>

{#snippet ways()}
  <div class="flex items-center gap-1.5">
    {#if pending !== null}
      <span class="flex items-center gap-1.5 text-small text-muted-foreground">
        <Waiting class="size-3" />
        {pendingWords(pending)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="rounded-full"
        disabled={flow.busy === 'cancel'}
        onclick={() => void flow.cancel()}
      >
        Cancel
      </Button>
    {:else}
      <Button type="button" size="sm" class="rounded-full" disabled={flow.busy !== null} onclick={signIn}>Sign in again</Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="rounded-full"
        data-panel-door
        onpointerdown={(event: PointerEvent) => event.preventDefault()}
        onclick={() => panel.open('model')}
      >
        Choose another account
      </Button>
    {/if}
  </div>
{/snippet}

{#snippet notice()}
  {#if signedOut !== null}
    <div class="grid gap-2" data-signed-out>
      <RunEndingStrip
        tone="waiting"
        text={failed === null ? `${signedOut.label} is signed out` : `Sign-in didn't finish, so ${signedOut.label} is still signed out`}
        action={ways}
      />
      {#if flow.place !== null && pending?.flow === 'external-cli'}
        <SignInTerminal execution={pending.execution} projectId={flow.place.id} program={signedOut.label} />
      {:else if flow.place !== null && failed !== null}
        <SignInTerminal execution={failed.execution} projectId={flow.place.id} program={signedOut.label} />
      {/if}
    </div>
  {/if}
{/snippet}
