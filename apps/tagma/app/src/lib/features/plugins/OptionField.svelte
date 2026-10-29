<script lang="ts">
  import type { PluginOptionRow } from '@tagma/server/plugins/contract/wire/rows';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';

  let {
    option,
    value,
    busy,
    onwrite,
  }: { option: PluginOptionRow; value: string; busy: boolean; onwrite: (value: string) => Promise<boolean> } = $props();

  let draft = $state<string | null>(null);
  const shown = $derived(draft ?? value);
  const standing = $derived(value === '' ? (option.fallback ?? '') : value);
  const said = $derived(value !== '' ? 'set' : option.fallback !== null ? 'default' : option.required ? 'required, not set' : 'not set');

  async function write(next: string): Promise<void> {
    const saved = await onwrite(next);
    if (saved && draft === next) draft = null;
  }
</script>

<div class="grid gap-2 border-t border-border bg-sunken px-3 py-3" data-option={option.key}>
  <div class="flex items-center gap-2">
    <span class="text-ui font-medium">{option.title}</span>
    <code class="stamp text-muted-foreground">{option.key}</code>
    <span class="text-ui text-muted-foreground">{said}</span>
    {#if option.type === 'boolean'}
      <span class="flex-1"></span>
      <SwitchControl label={option.title} value={standing === 'true'} disabled={busy} onwrite={(on) => void write(on ? 'true' : 'false')} />
    {/if}
  </div>
  {#if option.description !== ''}
    <p class="text-ui text-muted-foreground">{option.description}</p>
  {/if}
  {#if option.type !== 'boolean'}
    <form
      class="flex items-center gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        if (draft !== null && draft !== value) void write(draft);
      }}
    >
      <Input
        type={option.type === 'number' ? 'number' : 'text'}
        step={option.type === 'number' ? 'any' : undefined}
        class={option.type === 'directory' || option.type === 'file' ? 'font-mono' : undefined}
        placeholder={option.fallback ?? ''}
        value={shown}
        oninput={(event) => (draft = event.currentTarget.value)}
        disabled={busy}
      />
      <Button size="sm" type="submit" disabled={busy || draft === null || draft === value}>Save</Button>
    </form>
  {/if}
</div>
