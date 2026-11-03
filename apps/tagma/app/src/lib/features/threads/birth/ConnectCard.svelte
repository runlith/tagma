<script lang="ts">
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { Router } from '@runlith/layer/Router';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import type { ServedProvider } from '@tagma/server/providers/contract/wire/catalog';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { SignInFlow, pendingWords } from '$lib/features/providers/SignInFlow.svelte.js';
  import SignInTerminal from '$lib/features/providers/SignInTerminal.svelte';
  import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import { signInTrouble } from '$lib/features/providers/accounts/status.js';
  import { ExecutionsRepo } from '$lib/features/executions/Repo.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import { type CliInstall, installInTerminal } from '../external/install.js';
  import { AgentTypes } from '../AgentTypes.svelte.js';
  import { ModelDefaults } from '../ModelDefaults.svelte.js';

  let { projectId }: { projectId: number } = $props();

  const PLANS = 2;

  const catalog = ProviderCatalog.use();
  const accounts = AccountsRepo.use();
  const notices = Notices.use();
  const workspace = Workspace.use();
  const executions = ExecutionsRepo.use();
  const agents = AgentTypes.use();
  const defaults = ModelDefaults.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const links = ExternalLinks.use();
  const usage = UsageAccounts.use();

  const troubleOf = (provider: string): string | null => signInTrouble(usage.signing(provider), provider);

  const cliOf = (provider: string) => agents.launches.find((row) => row.presentation.modelProvider === provider);

  const plans = $derived(
    (defaults.plans ?? defaults.offered ?? [])
      .flatMap((id) => catalog.served.providers.find((provider) => provider.id === id) ?? [])
      .slice(0, PLANS),
  );

  const flows = new SvelteMap<string, SignInFlow>();
  let installing = $state<string | null>(null);

  function flowOf(provider: string): SignInFlow {
    const standing = flows.get(provider);
    if (standing !== undefined) return standing;
    const made = new SignInFlow(accounts, notices, links, () => provider, { signedIn: () => defaults.reread() });
    flows.set(provider, made);
    return made;
  }

  const optionOf = (provider: string) => catalog.section(provider)?.options.find((option) => option.provider === provider);

  $effect(() => () => {
    for (const flow of flows.values()) flow.dispose();
  });

  async function install(provider: string, cli: CliInstall): Promise<void> {
    const project = workspace.find(projectId);
    if (project === null) return;
    try {
      const terminal = await installInTerminal(executions, addresses, project, cli);
      if (terminal === null) return;
      installing = provider;
      void router.goto(terminal.href);
      await terminal.ended;
      await agents.read(true, true);
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      if (installing === provider) installing = null;
    }
  }

  async function signIn(provider: ServedProvider): Promise<void> {
    const section = catalog.section(provider.id);
    const option = optionOf(provider.id);
    if (section !== undefined && option !== undefined && section.selected !== option.id) {
      try {
        const next = await accounts.selectMode.run({ section: section.id, mode: option.id }, { throwOnError: true });
        if (next) catalog.adopt(next);
      } catch (error: unknown) {
        notices.refusal(error);
        return;
      }
    }
    await flowOf(provider.id).begin(workspace.find(projectId), provider.signInMethods[0]);
  }
</script>

<div class="grid w-full max-w-md justify-items-start gap-6 @min-[34rem]:justify-items-center" data-connect-model>
  <div class="grid gap-1 text-left @min-[34rem]:text-center">
    <p class="text-page text-foreground">Connect a model</p>
    <p class="text-ui text-muted-foreground">Agents run on a model you connect. Sign in with a plan you already have.</p>
  </div>
  <ul class="grid w-full divide-y rounded-lg border bg-raised">
    {#each plans as provider (provider.id)}
      {@const option = optionOf(provider.id)}
      {@const flow = flows.get(provider.id)}
      {@const host = cliOf(provider.id)}
      {@const waiting = flow !== undefined && flow.pending !== null}
      <li class="grid gap-3 px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="grid size-8 shrink-0 place-items-center rounded-md border bg-background">
            <ProviderMark provider={provider.id} class="size-4" titled={false} />
          </span>
          <div class="grid min-w-0 flex-1 gap-0.5">
            <span class="text-ui font-medium text-foreground">{provider.label}</span>
            {#if waiting}
              <span class="flex items-center gap-1.5 text-small text-muted-foreground">
                <Waiting class="size-3" />
                {flow?.pending ? pendingWords(flow.pending) : ''}
              </span>
            {:else if flow?.outcome?.kind === 'signed'}
              <span class="text-small text-status-done" role="status">Signed in as {flow.outcome.label}</span>
            {:else if flow?.outcome?.kind === 'failed'}
              <span class="text-small text-destructive" role="status">Sign-in didn't finish — nothing was added.</span>
            {:else}
              <span class="text-small text-muted-foreground">{option?.unavailable ?? troubleOf(provider.id) ?? option?.hint ?? ''}</span>
            {/if}
          </div>
          {#if waiting}
            <Button variant="ghost" size="sm" disabled={flow?.busy === 'cancel'} onclick={() => void flow?.cancel()}>Cancel</Button>
          {:else if option !== undefined && option.unavailable !== null}
            {#if host !== undefined && host.presentation.install !== null}
              {@const command = host.presentation.install}
              <Button
                variant="secondary"
                size="sm"
                disabled={installing === provider.id}
                onclick={() => void install(provider.id, { label: host.label, command })}
              >
                {installing === provider.id ? 'Installing…' : 'Install'}
              </Button>
            {/if}
          {:else}
            <Button variant="secondary" size="sm" disabled={flow !== undefined && flow.busy !== null} onclick={() => void signIn(provider)}>
              {option?.signInLabel ?? 'Sign in'}
            </Button>
          {/if}
        </div>
        {#if waiting && flow?.pending?.flow === 'external-cli'}
          <SignInTerminal execution={flow.pending.execution} {projectId} program={provider.label} />
        {:else if flow?.outcome?.kind === 'failed'}
          <SignInTerminal execution={flow.outcome.execution} {projectId} program={provider.label} />
        {/if}
      </li>
    {/each}
  </ul>
  <a
    href={settingsHref(router, 'providers')}
    class="-mx-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
  >
    <KeyRound class="size-3.5 shrink-0" />
    Use an API key instead
  </a>
</div>
