<script lang="ts">
  import { untrack } from 'svelte';

  let {
    value,
    left,
    label,
    class: className = '',
    onSave,
    onEnd,
  }: {
    value: string;
    left: string;
    label: string;
    class?: string;
    onSave: (text: string) => Promise<boolean>;
    onEnd: () => void;
  } = $props();

  let text = $state(untrack(() => value));
  let field = $state<HTMLInputElement | null>(null);
  let saving = false;
  let ended = false;

  $effect(() => {
    if (field === null) return;
    field.focus();
    field.select();
  });

  function end(): void {
    if (ended) return;
    ended = true;
    onEnd();
  }

  async function save(): Promise<void> {
    if (saving || ended) return;
    const next = text.replace(/\s+/g, ' ').trim();
    if (next === '' || next === value.replace(/\s+/g, ' ').trim()) {
      end();
      return;
    }
    saving = true;
    try {
      if (await onSave(next)) end();
    } finally {
      saving = false;
    }
  }
</script>

<input
  bind:this={field}
  bind:value={text}
  aria-label={label}
  spellcheck="false"
  maxlength={120}
  class={[
    'absolute top-[3px] right-1.5 z-10 h-5 min-w-0 rounded-sm bg-background px-1 leading-5 text-foreground outline-none outline-1 -outline-offset-1 outline-ring',
    className,
  ]}
  style:left
  onkeydown={(event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      end();
    }
  }}
  onblur={() => void save()}
/>
