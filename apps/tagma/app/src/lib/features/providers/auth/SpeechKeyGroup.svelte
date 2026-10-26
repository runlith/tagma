<script lang="ts">
  import type { ConsoleKeys } from '@tagma/server/providers/contract/wire/signIns';
  import { AccountKey } from '@runlith/llm/models/authStatus';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { SpeechRepo } from '$lib/features/speech/Repo.js';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';

  type Keyed = ConsoleKeys[number];

  const notices = Notices.use();
  const accounts = AccountsRepo.use();
  const speech = SpeechRepo.use();

  let { entry }: { entry: Keyed } = $props();

  const provider = $derived(entry.provider);
  const name = $derived(`${provider} speech API key`);

  let key = $state('');
  let busy = $state<string | null>(null);

  async function act(work: () => Promise<unknown>, mark: string): Promise<void> {
    busy = mark;
    try {
      await work();
      await accounts.consoleKeys.refresh();
      if (speech.status.data !== undefined) await speech.status.refresh();
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      busy = null;
    }
  }

  function save(): void {
    const pasted = key.trim();
    if (pasted === '') return;
    void act(async () => {
      await accounts.saveConsoleKey.run({ provider, key: pasted }, { throwOnError: true });
      key = '';
    }, 'save');
  }
</script>

<section class="@container overflow-hidden rounded-lg border bg-raised" aria-label={name}>
  <div class="flex min-h-9 items-center gap-2 px-3 py-1">
    <h3 class="text-ui font-semibold">{name}</h3>
    <span class="text-ui text-muted-foreground">
      {entry.keys.length === 0 ? 'not set' : entry.keys.length === 1 ? 'key set' : `${entry.keys.length} keys`}
    </span>
  </div>

  {#each entry.keys as row (row.account)}
    <div class="flex items-center gap-3 border-t border-border px-3 py-2" data-console-key={row.account}>
      <button
        type="button"
        role="radio"
        aria-checked={row.default}
        aria-label="Use {row.label} by default"
        class="grid size-3.5 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors {row.default
          ? 'border-foreground'
          : 'border-vein-strong hover:border-foreground'}"
        disabled={busy !== null}
        onclick={() =>
          !row.default &&
          void act(
            () => accounts.useByDefault.run({ provider, account: AccountKey.make(row.account) }, { throwOnError: true }),
            row.account,
          )}
      >
        {#if row.default}
          <span class="size-2 rounded-full bg-foreground"></span>
        {/if}
      </button>
      <span class="flex-1 font-mono text-ui {row.default ? 'text-foreground' : 'text-muted-foreground'}">{row.label}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onclick={() =>
          void act(() => accounts.removeConsoleKey.run({ provider, account: row.account }, { throwOnError: true }), row.account)}
      >
        Remove
      </Button>
    </div>
  {/each}

  <div class="grid gap-2 border-t border-border bg-sunken px-3 py-3">
    <p class="text-ui text-muted-foreground">Paste an API key for {provider}. It stays on this machine.</p>
    <div class="flex items-center gap-2">
      <Input type="password" class="font-mono" placeholder="Paste key…" bind:value={key} disabled={busy !== null} />
      <Button size="sm" disabled={busy !== null || key.trim() === ''} onclick={save}>
        {entry.keys.length === 0 ? 'Save' : 'Add'}
      </Button>
    </div>
  </div>
</section>
