<script lang="ts">
  import { PERMISSION_KINDS, type PermissionKind } from '@runlith/agent/permissions';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import type { McpDeclarationInput } from '$lib/features/mcp/Repo.js';

  let {
    busy = false,
    refusal,
    onsubmit,
    oncancel,
  }: {
    busy?: boolean;
    refusal?: { readonly code: string; readonly reason: string; readonly unblock: readonly string[] };
    onsubmit: (declaration: McpDeclarationInput) => void;
    oncancel: () => void;
  } = $props();

  let name = $state('');
  let transport = $state<'stdio' | 'http'>('stdio');
  let command = $state('');
  let args = $state('');
  let cwd = $state('');
  let url = $state('');
  let pairs = $state('');
  let kinds = $state<PermissionKind[]>([]);
  let mutates = $state(false);
  let timeout = $state('');

  const ready = $derived(name.trim() !== '' && (transport === 'stdio' ? command.trim() !== '' : url.trim() !== ''));

  function recordOf(text: string): Record<string, string> | undefined {
    const entries = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .flatMap((line) => {
        const at = line.indexOf('=');
        return at <= 0 ? [] : [[line.slice(0, at).trim(), line.slice(at + 1).trim()] as const];
      });
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
  }

  function words(text: string): readonly string[] | undefined {
    const parts = text.split(/\s+/).filter((part) => part !== '');
    return parts.length === 0 ? undefined : parts;
  }

  function submit(): void {
    if (!ready) return;
    const shared = {
      name: name.trim(),
      capabilities: { kinds, mutates },
      timeoutMs: timeout.trim() === '' ? undefined : Number(timeout),
    };
    const written = recordOf(pairs);
    const argued = words(args);
    onsubmit(
      transport === 'stdio'
        ? {
            ...shared,
            transport: 'stdio' as const,
            command: command.trim(),
            args: argued,
            cwd: cwd.trim() === '' ? undefined : cwd.trim(),
            env: written,
          }
        : {
            ...shared,
            transport: 'http' as const,
            url: url.trim(),
            headers: written,
          },
    );
  }

  function toggleKind(kind: PermissionKind, on: boolean): void {
    kinds = on ? [...kinds.filter((held) => held !== kind), kind] : kinds.filter((held) => held !== kind);
  }
</script>

<form
  class="grid gap-3 border-t border-border bg-sunken px-3 py-3"
  onsubmit={(event) => {
    event.preventDefault();
    submit();
  }}
>
  <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
    <label class="grid gap-1 text-small text-muted-foreground">
      Name
      <Input class="font-mono" placeholder="probe" bind:value={name} disabled={busy} />
    </label>
    <div class="grid gap-1 text-small text-muted-foreground">
      Transport
      <div class="flex overflow-hidden rounded-lg border">
        {#each ['stdio', 'http'] as const as option (option)}
          <button
            type="button"
            class="px-3 py-1 text-small transition-colors {transport === option ? 'bg-primary text-primary-foreground' : 'hover:bg-hover'}"
            class:border-l={option === 'http'}
            disabled={busy}
            onclick={() => (transport = option)}
          >
            {option}
          </button>
        {/each}
      </div>
    </div>
  </div>

  {#if transport === 'stdio'}
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="grid gap-1 text-small text-muted-foreground">
        Command
        <Input class="font-mono" placeholder="bun" bind:value={command} disabled={busy} />
      </label>
      <label class="grid gap-1 text-small text-muted-foreground">
        Arguments
        <Input class="font-mono" placeholder="run tools/probe/server.ts" bind:value={args} disabled={busy} />
      </label>
    </div>
    <label class="grid gap-1 text-small text-muted-foreground">
      Working directory — the server's own when empty
      <Input class="font-mono" bind:value={cwd} disabled={busy} />
    </label>
  {:else}
    <label class="grid gap-1 text-small text-muted-foreground">
      Endpoint
      <Input class="font-mono" placeholder="https://mcp.example.com/mcp" bind:value={url} disabled={busy} />
    </label>
  {/if}

  <label class="grid gap-1 text-small text-muted-foreground">
    {transport === 'stdio' ? 'Environment' : 'Headers'} — one <span class="font-mono">KEY=value</span> per line; a
    <span class="font-mono">{'${NAME}'}</span> is read from this server's own environment when it connects
    <textarea
      class="min-h-16 w-full resize-y rounded-lg border bg-background px-3 py-1.5 font-mono text-small outline-none transition-colors focus-visible:border-ring"
      spellcheck="false"
      bind:value={pairs}
      disabled={busy}></textarea>
  </label>

  <div class="grid gap-1.5">
    <span class="text-small text-muted-foreground"> What its calls may do — every call of this server is judged by this </span>
    <div class="flex flex-wrap items-center gap-3">
      {#each PERMISSION_KINDS as kind (kind)}
        <label class="flex items-center gap-1.5 text-small">
          <input
            type="checkbox"
            class="size-3.5 accent-primary"
            checked={kinds.includes(kind)}
            disabled={busy}
            onchange={(event) => toggleKind(kind, (event.currentTarget as HTMLInputElement).checked)}
          />
          {kind}
        </label>
      {/each}
      <label class="flex items-center gap-1.5 text-small">
        <input type="checkbox" class="size-3.5 accent-primary" bind:checked={mutates} disabled={busy} />
        changes durable data
      </label>
    </div>
  </div>

  <label class="grid w-40 gap-1 text-small text-muted-foreground">
    Request timeout (ms)
    <Input class="font-mono" type="number" inputmode="numeric" min={1} bind:value={timeout} disabled={busy} />
  </label>

  {#if refusal}
    <div class="grid gap-0.5 text-small">
      <p class="text-destructive"><span class="stamp">{refusal.code}</span> — {refusal.reason}</p>
      {#each refusal.unblock as way (way)}
        <p class="text-muted-foreground">{way}</p>
      {/each}
    </div>
  {/if}

  <div class="flex items-center justify-end gap-2">
    <Button variant="ghost" size="sm" type="button" disabled={busy} onclick={oncancel}>Cancel</Button>
    <Button size="sm" type="submit" disabled={busy || !ready}>{busy ? 'Adding…' : 'Add server'}</Button>
  </div>
</form>
