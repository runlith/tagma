<script lang="ts">
  import type { SecretSet } from '@tagma/server/secrets/contract/wire/rows';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { SecretsRepo } from '$lib/features/secrets/Repo.js';

  let { set, projectId, onchanged }: { set: SecretSet; projectId: number; onchanged?: () => Promise<unknown> } = $props();

  const notices = Notices.use();
  const secrets = SecretsRepo.use();

  let values = $state<Record<string, string>>({});
  let busy = $state<string | null>(null);

  async function act(name: string, work: () => Promise<unknown>): Promise<void> {
    busy = name;
    try {
      await work();
      await Promise.all([secrets.sets.key({ projectId, owner: set.owner }).refresh(), onchanged?.()]);
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      busy = null;
    }
  }

  function save(name: string): Promise<void> {
    const value = values[name] ?? '';
    return act(name, async () => {
      await secrets.set.run({ projectId, owner: set.owner, id: set.id, name, value }, { throwOnError: true });
      values[name] = '';
    });
  }

  function remove(name: string): Promise<void> {
    return act(name, () => secrets.remove.run({ projectId, owner: set.owner, id: set.id, name }, { throwOnError: true }));
  }
</script>

{#each set.secrets as secret (secret.name)}
  <div class="grid gap-2 border-t border-border bg-sunken px-3 py-3" data-secret={secret.name}>
    <div class="flex items-center gap-2">
      <Tooltip text={secret.set ? 'Has a value' : 'No value yet'}>
        <span class={['size-2 shrink-0 rounded-full', secret.set ? 'bg-status-done' : 'border border-vein-strong']}></span>
      </Tooltip>
      <code class="stamp text-ui">{secret.name}</code>
      <span class="text-ui text-muted-foreground">{secret.set ? 'set' : 'not set'}</span>
    </div>
    <p class="text-ui text-muted-foreground">{secret.description}</p>
    <div class="flex items-center gap-2">
      <Input
        type="password"
        class="font-mono"
        autocomplete="new-password"
        placeholder={secret.set ? 'Paste a new value…' : 'Paste the value…'}
        bind:value={values[secret.name]}
        disabled={busy !== null}
      />
      <Button
        variant="default"
        size="sm"
        disabled={busy !== null || (values[secret.name] ?? '') === ''}
        onclick={() => void save(secret.name)}
      >
        {secret.set ? 'Replace' : 'Save'}
      </Button>
      {#if secret.set}
        <Button variant="outline" size="sm" disabled={busy !== null} onclick={() => void remove(secret.name)}>Remove</Button>
      {/if}
    </div>
  </div>
{/each}
