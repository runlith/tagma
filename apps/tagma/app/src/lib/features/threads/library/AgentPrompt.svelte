<script lang="ts">
  import type { PromptDocument } from '@tagma/server/threads/contract/wire/agentLibrary';
  import Copy from '@lucide/svelte/icons/copy';
  import Disclosure from '$lib/shared/ui/Disclosure.svelte';
  import ChevronsDownUp from '@lucide/svelte/icons/chevrons-down-up';
  import { SvelteSet } from 'svelte/reactivity';
  import { tick } from 'svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { spellChord } from '$lib/shared/chordSpelling.js';
  import { Host } from '@runlith/layer/Host';
  import MarkdownBody from '$lib/features/graph/MarkdownBody.svelte';

  let { document, frozen = false }: { document: PromptDocument; frozen?: boolean } = $props();
  let raw = $state(false);
  let query = $state('');
  let copied = $state(false);
  let copyFailure = $state(false);
  let rawField = $state<HTMLTextAreaElement>();
  let container = $state<HTMLDivElement>();
  const apple = Host.use().apple;
  const closed = new SvelteSet<string>();
  const shown = $derived(
    document.sections.filter((section) => `${section.title}\n${section.text}`.toLowerCase().includes(query.toLowerCase())),
  );
  const allClosed = $derived(shown.length > 0 && shown.every((section) => closed.has(section.id)));

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(document.text);
      copied = true;
    } catch {
      copyFailure = true;
      raw = true;
      await tick();
      rawField?.focus();
      rawField?.select();
    }
  }
  async function jump(id: string): Promise<void> {
    query = '';
    raw = false;
    closed.delete(id);
    await tick();
    container?.querySelector<HTMLElement>(`[data-section="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function fold(): void {
    const expand = allClosed;
    for (const section of shown) {
      if (expand) closed.delete(section.id);
      else closed.add(section.id);
    }
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-2">
    <div class="flex items-center gap-1">
      <Button size="sm" variant={raw ? 'ghost' : 'secondary'} onclick={() => (raw = false)}>Document</Button>
      <Button size="sm" variant={raw ? 'secondary' : 'ghost'} onclick={() => (raw = true)}>Raw text</Button>
      <span class="ml-2 hidden text-meta text-muted-foreground lg:inline"
        >{frozen ? 'Saved bytes' : 'Assembled preview'} · {document.text.length.toLocaleString()} chars</span
      >
    </div>
    <div class="flex items-center gap-1.5">
      <Input
        class="h-8 w-36 border-transparent bg-transparent text-small"
        placeholder="Find in prompt…"
        aria-label="Find in prompt"
        bind:value={query}
      />
      <Tooltip text={allClosed ? 'Expand all' : 'Fold all'}
        ><Button size="icon-sm" variant="ghost" disabled={raw} onclick={fold} aria-label={allClosed ? 'Expand all' : 'Fold all'}
          ><ChevronsDownUp class="size-3.5" /></Button
        ></Tooltip
      >
      <Button size="sm" variant="outline" onclick={() => void copy()}><Copy class="size-3.5" />{copied ? 'Copied' : 'Copy'}</Button>
    </div>
  </div>
  <div class="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_12rem]">
    <div class="min-h-0 overflow-y-auto px-5 py-5 sm:px-8" bind:this={container}>
      {#if copyFailure}<p class="mb-3 text-small text-muted-foreground">
          Clipboard access was unavailable. The complete text is selected; press <Kbd
            chord={spellChord({ key: 'C', meta: apple, ctrl: !apple, alt: false, shift: false }, apple)}
            size="sm"
          />.
        </p>{/if}
      {#if raw}
        <textarea
          readonly
          class="h-full min-h-80 w-full resize-none rounded-sm border bg-sunken/40 p-4 font-mono text-small leading-6 outline-none"
          aria-label="Complete system prompt"
          value={document.text}
          bind:this={rawField}></textarea>
      {:else if document.text.length === 0}
        <p class="text-ui text-muted-foreground">No system prompt has been recorded yet.</p>
      {:else}
        <div class="mx-auto max-w-[78ch]">
          {#if query}<p class="mb-4 text-small text-muted-foreground">
              {shown.length} matching sections. Copy always includes the complete prompt.
            </p>{/if}
          {#each shown as section (section.id)}
            <Disclosure
              class="border-t last:border-b"
              summaryClass="w-full gap-2 py-4 text-ui font-medium text-foreground"
              data-section={section.id}
              bind:open={() => !closed.has(section.id), (open) => (open ? closed.delete(section.id) : closed.add(section.id))}
            >
              {#snippet summary()}<span>{section.title}</span>{/snippet}
              <div class="pb-5 pl-4">
                <MarkdownBody text={section.text} />
                <Disclosure class="mt-4 text-meta text-muted-foreground">
                  {#snippet summary()}Source{/snippet}
                  <p class="mt-2 break-all font-mono">{section.source}</p>
                </Disclosure>
              </div>
            </Disclosure>
          {/each}
        </div>
      {/if}
    </div>
    <nav class="hidden min-h-0 overflow-y-auto border-l px-4 py-6 xl:block" aria-label="Prompt outline">
      <h3 class="eyebrow mb-4 text-muted-foreground">In this prompt</h3>
      {#each document.sections as section (section.id)}
        <button
          class="block w-full border-l py-1.5 pl-3 text-left text-small text-muted-foreground hover:border-foreground hover:text-foreground"
          onclick={() => void jump(section.id)}>{section.title}</button
        >
      {/each}
      <p class="mt-6 border-t pt-4 text-meta leading-5 text-muted-foreground">
        {frozen
          ? 'Recorded text, not rebuilt from current files.'
          : 'Section titles and origins are reading metadata. Copy preserves the prompt’s own text.'}
      </p>
    </nav>
  </div>
</div>
