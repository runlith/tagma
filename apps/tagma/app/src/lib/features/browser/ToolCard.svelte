<script lang="ts">
  import Globe from '@lucide/svelte/icons/globe';
  import type { PageId } from '@tagma/server/browser/contract/wire/ids';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { diskAddress } from '$lib/features/checkout/files/disk.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import { Door } from '$lib/wire/Door.js';
  import { showPage } from './panes.js';

  let { entry }: { entry: ChatEntryOf<'tool'> } = $props();

  type Asked = { readonly page?: string; readonly url?: string; readonly go?: string; readonly action?: string; readonly ref?: string };
  type Seen = { readonly id?: string; readonly url?: string; readonly title?: string };
  type Answered = { readonly status?: string; readonly page?: Seen | string; readonly path?: string; readonly mediaType?: string };

  const panes = SidePanes.use();
  const door = Door.use();
  const project = ProjectRung.Current.use().projectId;

  const asked = $derived((entry.toolInput ?? {}) as Asked);
  const answered = $derived((entry.toolOutput ?? {}) as Answered);
  const seen = $derived(typeof answered.page === 'object' ? answered.page : null);
  const page = $derived(seen?.id ?? (typeof answered.page === 'string' ? answered.page : asked.page) ?? null);
  const what = $derived(
    [asked.action ?? asked.go ?? null, asked.ref ?? null, asked.url ?? null].filter((part): part is string => part !== null).join(' '),
  );
  const frame = $derived(
    answered.status === 'captured' && answered.path !== undefined && answered.mediaType?.startsWith('image/') === true
      ? diskAddress(door, answered.path)
      : null,
  );
</script>

{#if entry.toolRefusal}
  <p class="text-ui leading-snug break-words text-muted-foreground">{entry.toolRefusal.reason}</p>
{/if}
<div class="grid min-w-0 gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2" data-browser-tool={entry.toolName}>
  <div class="flex min-w-0 items-center gap-2">
    <Globe class="size-3.5 shrink-0 text-muted-foreground" />
    <div class="grid min-w-0 flex-1">
      <span class="truncate text-ui">{seen?.title || seen?.url || asked.url || (page === null ? 'Page' : `Page ${page.slice(-8)}`)}</span>
      {#if what !== '' || (seen?.url && seen.title)}
        <span class="truncate text-small text-muted-foreground">{what || seen?.url}</span>
      {/if}
    </div>
    {#if page !== null}
      <Button size="sm" variant="ghost" onclick={() => showPage(panes, { project, page: page as PageId })}>Show</Button>
    {/if}
  </div>
  {#if frame !== null}
    <img src={frame} alt="What the page showed" class="max-h-96 w-full rounded-md border border-border/60 object-contain object-left-top" />
  {/if}
</div>
