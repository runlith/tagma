<script lang="ts">
  import { cn } from '$lib/shared/utils.js';
  import type { Strictness } from './words.js';

  let {
    current,
    busy = false,
    onpick,
  }: { current: Strictness | null; busy?: boolean; onpick: (strictness: Strictness) => void } = $props();

  const CHOICES: readonly { readonly value: Strictness; readonly label: string; readonly dot: string }[] = [
    { value: 'note', label: 'Text only', dot: 'bg-status-none/70' },
    { value: 'watch', label: 'Warns', dot: 'border border-severity-gap' },
    { value: 'gate', label: 'Blocks', dot: 'bg-severity-lie' },
  ];

  const HINT: Readonly<Record<Strictness, string>> = {
    note: 'Agents follow it as text; no commit is checked.',
    watch: 'Commits land; what breaks the rule is listed here.',
    gate: 'A commit that adds a violation is refused.',
  };
</script>

<div class="flex flex-wrap items-center gap-3">
  <div class="inline-flex rounded-md border border-border bg-field p-0.5" role="radiogroup" aria-label="Strictness">
    {#each CHOICES as choice (choice.value)}
      <button
        type="button"
        role="radio"
        aria-checked={current === choice.value}
        disabled={busy}
        class={cn(
          'flex h-6 items-center gap-1.5 rounded-sm px-3 text-ui transition-colors disabled:opacity-60',
          current === choice.value ? 'bg-selected text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
        )}
        onclick={() => current !== choice.value && onpick(choice.value)}
      >
        <span class={cn('size-2 shrink-0 rounded-full', choice.dot)}></span>
        {choice.label}
      </button>
    {/each}
  </div>
  {#if current !== null}<span class="text-small text-muted-foreground">{HINT[current]}</span>{/if}
</div>
