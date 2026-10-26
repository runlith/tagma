<script lang="ts">
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import { Router } from '@runlith/layer/Router';
  import StaleMark from './StaleMark.svelte';
  import { projectOpen } from '$lib/features/workspace/address.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import LineCount from './LineCount.svelte';
  import { counted } from './holdingWords.js';
  import { lineCount } from './lineCount.js';
  import { Checkout } from './Selection.svelte.js';
  import { headOf, readingNote } from './reading.js';

  const checkout = Checkout.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const row = $derived(checkout.row);

  const head = $derived(row === null ? null : headOf(row));
  const note = $derived(row === null ? null : readingNote(row));
  const paths = $derived(checkout.paths);
  const weighed = $derived(lineCount(checkout.lines) !== null);
  const ahead = $derived(row?.ahead ?? 0);
  const behind = $derived(row?.behind ?? 0);
  const remote = $derived(row?.upstream ?? 'upstream');

  const said = $derived.by(() => {
    const lines = checkout.lines;
    const sums = typeof lines === 'string' ? null : lines;
    return [
      paths === 0
        ? 'No uncommitted changes'
        : `${counted(paths, 'file', 'files')} changed${sums === null ? '' : `: +${sums.added} −${sums.removed} lines`}`,
      ahead > 0 ? `${counted(ahead, 'commit', 'commits')} to push to ${remote}` : null,
      behind > 0 ? `${counted(behind, 'commit', 'commits')} to pull from ${remote}` : null,
    ]
      .filter((part) => part !== null)
      .join('\n');
  });
</script>

{#if checkout.absent !== null}
  <span class="shrink-0 text-muted-foreground/70" data-checkout-absent={checkout.absent}>
    {checkout.absent === 'no-working-copy' ? 'no working copy' : 'checkout unread'}
  </span>
{:else if row !== null && !row.repository && projectOpen(router)}
  <Tooltip text="The project folder is not under Git" side="top">
    <a
      href={addresses.surface('checkout')}
      class="shrink-0 rounded-sm px-1 whitespace-nowrap text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground"
      data-checkout-unversioned
    >
      no Git
    </a>
  </Tooltip>
{:else if row !== null && head !== null && projectOpen(router)}
  <Tooltip text={said} side="top">
    <a
      href={addresses.surface('checkout')}
      class="flex min-w-0 items-center gap-2 rounded-sm px-1 transition-colors hover:bg-hover hover:text-foreground"
      aria-label={said.replaceAll('\n', ' · ')}
      data-checkout-tenant
    >
      <GitBranch class="size-3 shrink-0" />
      {#if row.ref === null}
        <span class="truncate" data-checkout-head>{head}</span>
      {/if}
      {#if paths === 0}
        <span class="whitespace-nowrap" data-checkout-paths={paths}>clean</span>
      {:else if weighed}
        <LineCount lines={checkout.lines} class="shrink-0" data-checkout-paths={paths} />
      {:else}
        <span class="whitespace-nowrap tabular-nums" data-checkout-paths={paths}>{counted(paths, 'file', 'files')}</span>
      {/if}
      {#if behind > 0}
        <span class="whitespace-nowrap tabular-nums text-status-open" data-checkout-behind={behind}>↓{behind}</span>
      {/if}
      {#if ahead > 0}
        <span class="whitespace-nowrap tabular-nums text-muted-foreground/60" data-checkout-ahead={ahead}>↑{ahead}</span>
      {/if}
      {#if note !== null}
        <StaleMark {note} />
      {/if}
    </a>
  </Tooltip>
{/if}
