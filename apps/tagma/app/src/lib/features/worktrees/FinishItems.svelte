<script lang="ts">
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import type { Snippet } from 'svelte';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { baseName } from './BaseReading.svelte.js';
  import { Finishing, idleDays } from './Finishing.svelte.js';

  let { row, onDone, acts, opens, copies }: { row: WorktreePlace; onDone?: () => void; acts?: Snippet; opens?: Snippet; copies?: Snippet } =
    $props();

  const pick =
    (act: () => unknown): (() => void) =>
    () => {
      act();
      onDone?.();
    };
  const finishing = Finishing.use();
  const links = ExternalLinks.use();
  const into = $derived(baseName(row));
  const busy = $derived(finishing.actingOn(row.rootId) !== null);
  const idle = $derived(idleDays(row, Date.now()));
  const waiting = $derived(row.pending?.state === 'waiting');
  const pullRequest = $derived(finishing.pullRequests.get(row.rootId) ?? null);
  const tagma = $derived(row.kind === 'tagma');
  const finishes = $derived(tagma && !row.missing);
  const acting = $derived(acts !== undefined || finishes);
  const opening = $derived(opens !== undefined || (finishes && pullRequest !== null));
</script>

{#if acting}
  {@render acts?.()}
  {#if finishes}
    <DropdownMenu.Item
      icon={PencilLine}
      disabled={busy || row.branch === null}
      onSelect={pick(() => finishing.askRename(row))}
      data-finish-item="rename"
    >
      Rename…
    </DropdownMenu.Item>
    {#if waiting}
      <DropdownMenu.Item
        icon={GitMerge}
        disabled={busy}
        onSelect={pick(() => void finishing.cancelMerge(row))}
        data-finish-item="stop-waiting"
      >
        Stop waiting for {into}
      </DropdownMenu.Item>
    {:else}
      <DropdownMenu.Item
        icon={GitMerge}
        disabled={busy || row.base?.branch == null}
        onSelect={pick(() => finishing.askMerge(row))}
        data-finish-item="merge"
      >
        Merge into {into}…
      </DropdownMenu.Item>
    {/if}
    {#if pullRequest === null}
      <DropdownMenu.Item
        icon={GitPullRequest}
        disabled={busy || row.base?.branch == null}
        onSelect={pick(() => void finishing.pullRequest(row))}
        data-finish-item="pull-request"
      >
        {finishing.actingOn(row.rootId) === 'pull-request' ? 'Opening a pull request…' : 'Open a pull request'}
      </DropdownMenu.Item>
    {/if}
    {#if row.base?.branch != null}
      <DropdownMenu.Item icon={RefreshCw} disabled={busy} onSelect={pick(() => void finishing.update(row))} data-finish-item="update">
        Update from {into}
      </DropdownMenu.Item>
    {/if}
  {/if}
{/if}
{#if opening}
  {#if acting}<DropdownMenu.Separator />{/if}
  {@render opens?.()}
  {#if finishes && pullRequest !== null}
    <DropdownMenu.Item icon={GitPullRequest} onSelect={pick(() => links.open(pullRequest))} data-finish-item="pull-request">
      Open the pull request
    </DropdownMenu.Item>
  {/if}
{/if}
{#if copies !== undefined}
  {#if acting || opening}<DropdownMenu.Separator />{/if}
  {@render copies()}
{/if}
{#if tagma}
  {#if acting || opening || copies !== undefined}<DropdownMenu.Separator />{/if}
  <DropdownMenu.Item
    variant="destructive"
    icon={Trash2}
    current={idle === null ? null : `Idle ${idle}d`}
    disabled={busy}
    onSelect={pick(() => void finishing.remove(row))}
    data-finish-item="delete"
  >
    Delete
  </DropdownMenu.Item>
{/if}
