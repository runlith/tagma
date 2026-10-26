<script lang="ts">
  import { onMount, untrack } from 'svelte';

  let {
    initial = '',
    stem = false,
    label,
    onCommit,
    onCancel,
  }: {
    initial?: string;
    stem?: boolean;
    label: string;
    onCommit: (name: string) => Promise<boolean>;
    onCancel: () => void;
  } = $props();

  let input: HTMLInputElement;
  let value = $state(untrack(() => initial));
  let finished = false;
  let failed = false;

  onMount(() => {
    input.focus();
    const dot = initial.lastIndexOf('.');
    input.setSelectionRange(0, stem && dot > 0 ? dot : initial.length);
  });

  async function finish(commit: boolean): Promise<void> {
    if (finished) return;
    finished = true;
    if (!commit || value.trim() === '' || value === initial) {
      onCancel();
      return;
    }
    if (await onCommit(value)) return;
    failed = true;
    finished = false;
    input?.focus();
  }

  function keys(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      void finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      void finish(false);
    }
  }
</script>

<input
  bind:this={input}
  bind:value
  class="h-5 min-w-0 flex-1 rounded-sm bg-field px-1 text-ui text-foreground outline-none inset-ring-1 inset-ring-ring"
  type="text"
  spellcheck="false"
  autocomplete="off"
  aria-label={label}
  onkeydown={keys}
  onclick={(event) => event.stopPropagation()}
  onblur={() => void finish(!failed)}
  data-tree-input
/>
