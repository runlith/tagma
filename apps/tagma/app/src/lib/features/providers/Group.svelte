<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleX from '@lucide/svelte/icons/circle-x';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Globe from '@lucide/svelte/icons/globe';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import { terminalKey, type ExecutionAddress } from '$lib/features/executions/Repo.js';
  import { Button, buttonVariants } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { MenuIcon } from '$lib/shared/ui/dropdown-menu/row.js';
  import type { SignInMethod } from '@runlith/llm/oauth/vendor';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import AccountRow from '$lib/features/providers/accounts/Row.svelte';
  import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { CountdownClock } from '$lib/features/providers/accounts/CountdownClock.svelte.js';
  import { cacheLifetimeBuckets, cacheLifetimeLine } from './auth/cacheLifetimeWords.js';
  import { usageStatus } from '$lib/features/providers/accounts/status.js';
  import { SignInFlow } from './SignInFlow.svelte.js';
  import SignInTerminal from './SignInTerminal.svelte';
  import CatalogState from './models/CatalogState.svelte';
  import RefreshModels from './models/RefreshModels.svelte';

  const notices = Notices.use();
  const usageAccounts = UsageAccounts.use();
  const catalog = ProviderCatalog.use();
  const countdownClock = CountdownClock.use();
  const accounts = AccountsRepo.use();
  const workspace = Workspace.use();
  const addresses = Addresses.use();
  const links = ExternalLinks.use();

  type CacheLifetime = NonNullable<Awaited<ReturnType<typeof accounts.cacheLifetime.loadOrThrow>>>[number];

  let { provider, lifetime = undefined }: { provider: string; lifetime?: CacheLifetime } = $props();

  const flow = new SignInFlow(accounts, notices, links, () => provider);

  const name = $derived(catalog.name(provider));
  const section = $derived(catalog.section(provider));
  const selected = $derived(section?.options.find((option) => option.id === section.selected));
  const unavailable = $derived(selected?.unavailable ?? null);
  const rows = $derived(unavailable === null ? usageAccounts.of(provider) : []);
  const signed = $derived(rows.filter((row) => row.problem === null));
  const attention = $derived(rows.some((row) => usageStatus(row, catalog.provider(provider), countdownClock.now).tone !== 'plain'));

  const served = $derived(catalog.provider(provider));
  const methods = $derived(served?.signInMethods ?? []);
  const methodLabels: Record<SignInMethod, string> = {
    loopback: 'Sign in with browser',
    device: 'Device code',
    paste: 'Paste authorization code',
    key: 'API key',
    'external-cli': 'Official CLI',
  };
  const methodIcons: Record<SignInMethod, MenuIcon> = {
    loopback: Globe,
    device: Smartphone,
    paste: ClipboardPaste,
    key: KeyRound,
    'external-cli': SquareTerminal,
  };
  let moding = $state(false);
  let showOutput = $state(false);
  const pending = $derived(flow.pending);
  const outcome = $derived(flow.outcome);
  const outcomeIsDefault = $derived(outcome?.kind === 'signed' && rows.some((row) => row.account === outcome.account && row.default));
  const busy = $derived(moding || flow.busy !== null);

  $effect(() => countdownClock.watch());

  $effect(() => () => flow.dispose());

  function begin(method?: SignInMethod, reconnect?: string): Promise<void> {
    return flow.begin(workspace.contextProject, method, reconnect);
  }

  async function selectMode(mode: string): Promise<void> {
    if (section === undefined || mode === section.selected) return;
    moding = true;
    try {
      const next = await accounts.selectMode.run({ section: section.id, mode }, { throwOnError: true });
      if (next) catalog.adopt(next);
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      moding = false;
    }
  }

  function copyCode(code: string): void {
    void navigator.clipboard?.writeText(code);
  }

  const ARROW_STEP: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
  function stepDefault(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
    const step = ARROW_STEP[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const at = radios.findIndex((radio) => radio.getAttribute('aria-checked') === 'true');
    const next = radios[((at === -1 ? 0 : at) + step + radios.length) % radios.length];
    if (next === undefined || next.disabled) return;
    next.focus();
    next.click();
  }
</script>

{#snippet signInTerminal(execution: ExecutionAddress)}
  {#if flow.place !== null}
    <SignInTerminal {execution} projectId={flow.place.id} program={name} />
  {/if}
{/snippet}

<section class="@container overflow-hidden rounded-lg border bg-raised" aria-label={name}>
  <div class="flex min-h-9 items-center gap-2 px-3 py-1">
    <ProviderMark {provider} class="size-4 text-foreground" />
    <Tooltip text={lifetime === undefined ? undefined : `Cache · ${cacheLifetimeLine(lifetime)} · ${cacheLifetimeBuckets(lifetime)}`}>
      <h3 class="text-ui font-semibold">{name}</h3>
    </Tooltip>
    {#if usageAccounts.known}
      {#if signed.length === 0}
        <Tooltip text={rows.length === 0 ? 'No account' : 'No account is signed in'}>
          <span class="size-2 shrink-0 rounded-full border-[1.5px] border-vein-strong"></span>
        </Tooltip>
        <span class="text-ui text-muted-foreground">not connected</span>
      {:else}
        <Tooltip text={attention ? 'An account needs attention' : 'Connected'}>
          <span class="size-2 shrink-0 rounded-full {attention ? 'bg-severity-gap' : 'bg-status-done'}"></span>
        </Tooltip>
        <span class="text-ui text-muted-foreground tabular">{signed.length} account{signed.length === 1 ? '' : 's'}</span>
      {/if}
    {/if}
    <span class="flex-1"></span>
    {#if section?.failure !== undefined}
      <Tooltip text={section.failure}>
        <span class="text-small text-severity-gap">Sign-in mode not saved</span>
      </Tooltip>
    {/if}
    {#if section !== undefined && section.options.length > 1}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class={buttonVariants({ variant: 'ghost', size: 'sm' })} disabled={busy || pending !== null}>
          Sign in with {selected?.label}
          <ChevronDown class="size-3.5" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-80 max-w-sm">
          <DropdownMenu.Label>Sign in with</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={section.selected} onValueChange={(mode) => void selectMode(mode)}>
            {#each section.options as option (option.id)}
              <DropdownMenu.RadioItem value={option.id} disabled={option.unavailable !== null} title={option.unavailable ?? option.hint}>
                {option.label}
              </DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator />
          <DropdownMenu.Note
            title="Switching keeps the other mode’s accounts; they come back when you switch back."
            text="The other mode keeps its accounts"
          />
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
    {#if served?.dynamicCatalog}
      <RefreshModels {provider} />
    {/if}
    {#if pending === null}
      {#if usageAccounts.known}
        {#if unavailable !== null}
          <span class="text-small text-muted-foreground">{unavailable}</span>
        {:else if served?.kind === 'harness' && served.auth === 'api-key'}
          {#each methods as method (method)}
            <Button variant={method === 'key' ? 'outline' : 'default'} size="sm" disabled={busy} onclick={() => void begin(method)}
              >{methodLabels[method]}</Button
            >
          {/each}
        {:else if methods.length > 1}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class={buttonVariants({ variant: signed.length > 0 ? 'outline' : 'default', size: 'sm' })}
              disabled={busy}
            >
              {signed.length > 0 ? 'Add account' : (selected?.signInLabel ?? 'Add account')}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {#each methods as method (method)}
                <DropdownMenu.Item icon={methodIcons[method]} onSelect={() => void begin(method)}>{methodLabels[method]}</DropdownMenu.Item>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {:else}
          <Button
            variant={signed.length > 0 ? 'outline' : 'default'}
            size="sm"
            disabled={busy || methods.length === 0}
            onclick={() => void begin(methods[0])}
          >
            {signed.length > 0 ? 'Add account' : (selected?.signInLabel ?? 'Sign in')}
          </Button>
        {/if}
      {/if}
    {:else}
      <Button variant="ghost" size="sm" disabled={flow.busy === 'cancel'} onclick={() => void flow.cancel()}>Cancel</Button>
    {/if}
  </div>

  {#if served?.keyHint}
    <p class="border-t border-border px-3 py-2 text-small text-muted-foreground">{served.keyHint}</p>
  {/if}
  {#if served?.dynamicCatalog && Object.keys(served.models).length === 0}
    <p class="border-t border-border px-3 py-2 text-small text-muted-foreground">Sign in to load the models available to your account.</p>
  {/if}
  <CatalogState {served} />

  {#if pending !== null}
    <div class="grid gap-2 border-t border-border bg-sunken px-3 py-3 text-ui">
      {#if pending.flow === 'device'}
        {@const code = pending.userCode}
        <p class="text-muted-foreground">Enter this code at {name}, then leave this page open.</p>
        <div class="flex items-center gap-3">
          <span class="rounded-lg border bg-raised px-3 py-1.5 font-mono text-body">{code}</span>
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-1 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            onclick={() => copyCode(code)}
          >
            <Copy class="size-3" />
            Copy
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <a
            href={pending.authorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-ui font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <ExternalLink class="size-3.5" />
            Open {name}
          </a>
          <span class="flex items-center gap-2 text-small text-muted-foreground">
            <Waiting class="size-3" />
            Waiting for authorization
          </span>
        </div>
      {:else if pending.flow === 'paste' || pending.flow === 'key'}
        {#if pending.flow === 'paste'}
          <a
            href={pending.authorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 text-small text-muted-foreground hover:text-foreground"
          >
            <ExternalLink class="size-3.5" /> Open {name}
          </a>
        {/if}
        <form
          class="flex items-center gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            void flow.complete();
          }}
        >
          <Input
            type="password"
            bind:value={flow.code}
            autocomplete="off"
            aria-label={pending.flow === 'paste' ? 'Authorization code' : 'API key'}
            placeholder={pending.flow === 'paste' ? 'Paste the code from the vendor page' : 'Paste API key'}
          />
          <Button type="submit" size="sm" disabled={busy || flow.code.trim() === ''}>Complete sign-in</Button>
        </form>
      {:else if pending.flow === 'external-cli'}
        {@const terminal = addresses.terminal(terminalKey(pending.execution), flow.place?.name)}
        <div class="flex items-center gap-2">
          <Waiting class="size-3.5 text-muted-foreground" />
          Waiting for the {name} CLI…
          <span class="flex-1"></span>
          <a
            href={terminal}
            class="inline-flex items-center gap-1.5 text-small font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <SquareTerminal class="size-3" />
            Open in terminal panel
          </a>
        </div>
        {@render signInTerminal(pending.execution)}
        <p class="text-small text-muted-foreground">
          Approve in the browser, paste the code into the terminal above — the account appears in this card.
        </p>
      {:else}
        <div class="flex items-center gap-2">
          <Waiting class="size-3.5 text-muted-foreground" />
          Waiting for the browser…
        </div>
        <p class="text-small text-muted-foreground">Approve there and the account appears here; nothing has to be brought back.</p>
        <a
          href={pending.authorizeUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex w-fit items-center gap-1.5 text-small font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ExternalLink class="size-3" />
          Open again
        </a>
      {/if}
    </div>
  {/if}

  {#if outcome !== null}
    <div class="grid gap-2 border-t border-border bg-sunken px-3 py-3 text-ui" role="status">
      {#if outcome.kind === 'signed'}
        <div class="flex items-center gap-2">
          <CircleCheck class="size-4 shrink-0 text-status-done" />
          <p>
            Signed in as <span class="font-medium">{outcome.label}</span>.{outcomeIsDefault ? ` It is the default ${name} account.` : ''}
          </p>
          <span class="flex-1"></span>
          <Button variant="outline" size="sm" onclick={() => flow.dismiss()}>Done</Button>
        </div>
        {#if outcome.execution !== null}
          {@const execution = outcome.execution}
          <button
            type="button"
            class="inline-flex w-fit items-center gap-1 text-small text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showOutput}
            onclick={() => (showOutput = !showOutput)}
          >
            <ChevronRight class="size-3 {showOutput ? 'rotate-90' : ''}" />
            Show sign-in output
          </button>
          {#if showOutput}
            {@render signInTerminal(execution)}
          {/if}
        {/if}
      {:else}
        <div class="flex items-center gap-2">
          <CircleX class="size-4 shrink-0 text-destructive" />
          <p>Sign-in didn't finish — the {name} CLI ended without a signed-in account, so nothing was added.</p>
          <span class="flex-1"></span>
          <Button variant="ghost" size="sm" onclick={() => flow.dismiss()}>Dismiss</Button>
          <Button size="sm" disabled={busy} onclick={() => void begin('external-cli', outcome.retryAccount)}>Try again</Button>
        </div>
        {@render signInTerminal(outcome.execution)}
      {/if}
    </div>
  {/if}

  {#if rows.length > 0}
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <div role="radiogroup" aria-label="{name} default account" tabindex={-1} onkeydown={stepDefault}>
      {#each rows as row (row.account)}
        <AccountRow
          {row}
          onSignIn={() => void begin(undefined, row.problem?.kind === 'unsupported-method' ? undefined : String(row.account))}
        />
      {/each}
    </div>
  {/if}
</section>
