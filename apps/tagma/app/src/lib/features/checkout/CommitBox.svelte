<script lang="ts">
  import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { holderKey } from '@tagma/server/workspace/contract/wire/checkout';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { threadLink } from '$lib/features/presence/link.js';
  import type { Editing, Writer } from './threadGroups.js';

  let {
    staged,
    editing,
    pushable,
    committing,
    formatRefused,
    message = $bindable(''),
    onCommit,
    onWithoutFormat,
    onEdit,
  }: {
    staged: number;
    editing: Editing | null;
    pushable: boolean;
    committing: boolean;
    formatRefused: boolean;
    message?: string;
    onCommit: (input: { message: string; amend?: boolean; push?: boolean }) => void;
    onWithoutFormat: () => void;
    onEdit: () => void;
  } = $props();

  const WRITERS_SHOWN = 3;
  const keymap = Keymap.use();
  const opening = Opening.use();
  const here = App.current();

  const WRITER_LINK = 'cursor-pointer underline decoration-status-in-work/40 underline-offset-2 hover:decoration-current';

  let everyWriter = $state(false);

  const ready = $derived(message.trim() !== '' && staged > 0 && !committing);

  function commit(extra: { amend?: boolean; push?: boolean } = {}): void {
    if (!ready) return;
    onCommit({ message: message.trim(), ...extra });
  }

  function keys(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    commit();
  }
</script>

{#snippet named(writer: Writer)}{#if writer.holder.kind === 'thread'}{@const thread = writer.holder.thread}<button
      type="button"
      class={WRITER_LINK}
      {@attach linkTarget(opening, () => threadLink({ threadId: thread }), here)}
      data-checkout-writer={thread}>{writer.name}</button
    >{:else}{writer.name}{/if}{/snippet}

<div class="grid shrink-0 gap-1.5 border-b p-2" data-checkout-commit>
  <textarea
    bind:value={message}
    rows="2"
    placeholder="Message"
    aria-label="Commit message"
    onkeydown={keys}
    oninput={onEdit}
    class="min-h-0 w-full resize-none rounded-md bg-sunken px-2 py-1.5 text-ui text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:inset-ring-1 focus-visible:inset-ring-ring"
  ></textarea>
  <div class="flex items-center gap-1">
    <Tooltip text="Commit" keys={keymap.spellText('Mod+Enter')} class="flex flex-1">
      <Button size="sm" class="h-7 flex-1" disabled={!ready} onclick={() => commit()} aria-busy={committing}>
        {#if committing}
          <Waiting class="size-3.5" />Committing…
        {:else}
          {staged === 0 ? 'Commit' : `Commit ${staged} ${staged === 1 ? 'file' : 'files'}`}
        {/if}
      </Button>
    </Tooltip>
    <DropdownMenu.Root>
      <Tooltip text="More commit actions">
        <DropdownMenu.Trigger
          class="grid h-7 w-7 shrink-0 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50 data-[state=open]:bg-selected"
          aria-label="More commit actions"
          disabled={!ready}
        >
          <ChevronDown class="size-3.5" />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Content align="end" class="min-w-44">
        {#if pushable}
          <DropdownMenu.Item icon={ArrowUpFromLine} onSelect={() => commit({ push: true })}>Commit and push</DropdownMenu.Item>
        {/if}
        <DropdownMenu.Item icon={GitCommitHorizontal} onSelect={() => commit({ amend: true })}>Amend last commit</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
  {#if formatRefused}
    <Button size="sm" variant="outline" class="h-7" disabled={committing} onclick={onWithoutFormat} data-checkout-without-format>
      Commit without formatting
    </Button>
  {/if}
  {#if editing !== null}
    {@const shown = everyWriter ? editing.writers : editing.writers.slice(0, WRITERS_SHOWN)}
    {@const hidden = editing.writers.length - shown.length}
    <p class="flex items-baseline gap-1.5 text-small text-status-in-work" data-checkout-writing-now>
      <span class="size-1.5 shrink-0 rounded-full bg-status-in-work"></span>
      <span class="min-w-0"
        >{#each shown as writer, at (holderKey(writer.holder))}{#if at > 0}{', '}{/if}{@render named(
            writer,
          )}{/each}{#if hidden > 0}{' '}<button type="button" class={WRITER_LINK} onclick={() => (everyWriter = true)}
            >and {hidden} more</button
          >{/if}{' '}{editing.writers.length === 1 ? 'is' : 'are'} still editing {editing.what}</span
      >
    </p>
  {/if}
</div>
