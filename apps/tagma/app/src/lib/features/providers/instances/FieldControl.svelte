<script lang="ts">
  import type { SettingField } from '@runlith/tagma/adapter/settings';
  import { Input } from '$lib/shared/ui/input/index.js';
  import * as Select from '$lib/shared/ui/select/index.js';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';

  let { field, value = $bindable() }: { field: SettingField; value: unknown } = $props();

  const NOT_SET = '';

  const chosen = $derived(field.type === 'choice' ? field.options.find((option) => option.id === value) : undefined);
  const picked = $derived<readonly string[]>(Array.isArray(value) ? value : []);

  function toggle(id: string): void {
    if (field.type !== 'set') return;
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    value = field.options.flatMap((option) => (next.has(option.id) ? [option.id] : []));
  }
</script>

<div class="grid min-w-0 gap-1">
  {#if field.secret === true}
    <span class="text-small text-muted-foreground">{field.label}</span>
    <div class="flex items-center gap-2">
      <Input
        type="password"
        value={typeof value === 'string' ? value : ''}
        oninput={(event) => (value = event.currentTarget.value)}
        autocomplete="off"
        aria-label={field.label}
        placeholder={value === null
          ? 'Will be removed on save'
          : field.type === 'text'
            ? 'Type to set or replace'
            : 'Enter a JSON value to set or replace'}
      />
      <button
        type="button"
        class="shrink-0 rounded-md px-2 py-1 text-small text-muted-foreground hover:bg-hover"
        onclick={() => (value = null)}>Clear</button
      >
    </div>
    <span class="text-meta text-muted-foreground">Stored values are never displayed. Leave blank to keep the value.</span>
  {:else if field.type === 'flag'}
    <div class="flex items-center gap-2">
      <SwitchControl label={field.label} value={value === true} onwrite={(next) => (value = next)} />
      <button type="button" tabindex="-1" aria-hidden="true" class="text-left text-ui" onclick={() => (value = value !== true)}>
        {field.label}
      </button>
    </div>
  {:else}
    <span class="text-small text-muted-foreground">
      {field.label}{#if field.type === 'number' && field.unit !== undefined}{' '}<span class="text-meta">· {field.unit}</span>{/if}
      {#if field.required === true}<span class="text-destructive"> *</span>{/if}
    </span>
    {#if field.type === 'text'}
      <Input bind:value placeholder={field.placeholder} aria-label={field.label} aria-required={field.required === true} />
    {:else if field.type === 'number'}
      <Input
        bind:value
        inputmode="numeric"
        placeholder={field.placeholder}
        aria-label={field.label}
        aria-required={field.required === true}
      />
    {:else if field.type === 'choice'}
      <Select.Root value={typeof value === 'string' ? value : NOT_SET} onValueChange={(next) => (value = next)}>
        <Select.Trigger class="w-full" aria-label={field.label}>
          <span class="min-w-0 truncate {chosen === undefined ? 'text-muted-foreground' : 'text-foreground'}"
            >{chosen?.label ?? 'Not set'}</span
          >
        </Select.Trigger>
        <Select.Content>
          {#if field.required !== true}
            <Select.Item value={NOT_SET} label="Not set"><span class="text-muted-foreground">Not set</span></Select.Item>
          {/if}
          {#each field.options as option (option.id)}
            <Select.Item value={option.id} label={option.label}>{option.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    {:else if field.type === 'set'}
      <div class="flex flex-wrap gap-1" role="group" aria-label={field.label}>
        {#each field.options as option (option.id)}
          {@const here = picked.includes(option.id)}
          <button
            type="button"
            role="checkbox"
            aria-checked={here}
            class="rounded-md border px-2 py-0.5 text-small transition-colors {here
              ? 'bg-selected text-foreground'
              : 'text-muted-foreground hover:bg-hover'}"
            onclick={() => toggle(option.id)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    {/if}
  {/if}
  {#if field.hint !== undefined}
    <span class="text-meta text-muted-foreground">{field.hint}</span>
  {/if}
</div>
