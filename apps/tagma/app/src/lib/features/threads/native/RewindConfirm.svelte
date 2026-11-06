<script lang="ts">
  import { clipLabel } from '@runlith/utils/text';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { tokensWord } from './compactionWords.js';
  import type { Rewinds } from './Rewinds.svelte.js';

  let { rewinds }: { rewinds: Rewinds } = $props();

  let revertLines = $state(false);
  const asking = $derived(rewinds.asking);

  $effect(() => {
    if (asking !== null) revertLines = false;
  });

  const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
</script>

{#snippet line(warn: boolean, text: string, path?: string)}
  <li class="grid grid-cols-[1rem_1fr] gap-2">
    <span class={['font-mono', warn ? 'text-status-in-work' : 'text-muted-foreground']} aria-hidden="true">{warn ? '!' : '·'}</span>
    <span>
      {text}{#if path !== undefined}
        <code class="ml-1 break-all font-mono text-small">{path}</code>
      {/if}
    </span>
  </li>
{/snippet}

{#if asking !== null}
  {@const preview = asking.read.preview}
  {@const files = asking.read.files}
  {@const acts = asking.read.graph.acts}
  {@const own = files.files.filter((file) => file.own.added + file.own.removed > 0)}
  {@const held = files.files.filter((file) => file.held.length > 0)}
  {@const children = preview.children.filter((child) => child.running)}
  {@const words = preview.draft?.text.replace(/\s+/g, ' ').trim() ?? ''}
  <Dialog.Root
    open
    onOpenChange={(next) => {
      if (!next) rewinds.cancel();
    }}
  >
    <Dialog.Content class="gap-4 sm:max-w-lg">
      <Dialog.Header>
        <Dialog.Title class="text-page">
          {asking.scope === 'turn' ? 'Drop this turn' : `Rewind ${count(preview.turns, 'turn', 'turns')}`}{#if words !== ''}&nbsp;to «{clipLabel(
              words,
              48,
            )}»{/if}
        </Dialog.Title>
        <Dialog.Description>The conversation goes back; what these turns did outside it stays.</Dialog.Description>
      </Dialog.Header>
      <ul class="grid gap-2 text-ui">
        {#if preview.running !== null}
          {@render line(true, 'The turn that is running now is stopped first.')}
        {/if}
        {#if files.unavailable !== null}
          {@render line(true, `Which files these turns changed cannot be read: ${files.unavailable}.`)}
        {:else if files.total > 0}
          {@render line(
            true,
            `${count(files.total, 'file', 'files')} changed stay as they are${held.length > 0 ? ` (${held.length} also hold another session's lines)` : ''} in checkout:`,
            files.root ?? undefined,
          )}
          <li class="max-h-60 overflow-y-auto pl-6">
            <ul class="grid gap-1">
              {#each files.files as file (file.path)}
                <li class="break-all font-mono text-small">{file.path}</li>
              {/each}
            </ul>
            {#if files.total > files.files.length}
              <p class="mt-1 text-small text-muted-foreground">
                {count(files.total - files.files.length, 'more changed file', 'more changed files')} in this checkout.
              </p>
            {/if}
          </li>
        {/if}
        {#if acts.length > 0}
          {@render line(
            true,
            `${count(acts.length, 'graph write', 'graph writes')}${asking.read.graph.bounded ? ' or more' : ''}. The graph is shared; they stay.`,
          )}
        {/if}
        {#each asking.read.graph.unread as graph (graph.root)}
          {@render line(true, `Graph writes cannot be counted in this checkout: ${graph.reason}`, graph.root)}
        {/each}
        {#each children as child (child.threadId)}
          {@render line(
            false,
            'A child agent keeps working; its report arrives here as an ordinary message:',
            child.name ?? child.threadId,
          )}
        {/each}
        {#if preview.taken.length > 0}
          {@render line(
            false,
            `${count(preview.taken.length, 'waiting message comes', 'waiting messages come')} back to the composer instead of running.`,
          )}
        {/if}
        {#if preview.rewriteTokens > 0}
          {@render line(
            false,
            `The prompt cache past this point is dropped: the next turn writes about ${tokensWord(preview.rewriteTokens)} tokens again.`,
          )}
        {/if}
      </ul>
      {#if own.length > 0}
        <label class="flex cursor-pointer items-start gap-2 text-ui">
          <input type="checkbox" class="mt-0.5 accent-primary" bind:checked={revertLines} />
          <span>
            Also revert this thread's lines in checkout <code class="break-all font-mono text-small">{files.root}</code>
            <span class="block text-small text-muted-foreground">Lines already committed, or since changed by another session, stay.</span>
          </span>
        </label>
      {/if}
      <Dialog.Footer>
        <Button variant="outline" onclick={() => rewinds.cancel()}>Cancel</Button>
        <Button onclick={() => rewinds.confirm(revertLines)}>{asking.scope === 'turn' ? 'Drop turn' : 'Rewind'}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
