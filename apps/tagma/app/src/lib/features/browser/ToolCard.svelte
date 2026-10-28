<script module lang="ts">
  import { Schema } from 'effect';
  import { ActionStep } from '@tagma/server/browser/contract/wire/pageOperations';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';

  const Asked = Schema.Struct({
    page: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String),
    go: Schema.optional(Schema.String),
    action: Schema.optional(Schema.String),
    ref: Schema.optional(Schema.String),
    steps: Schema.optional(Schema.Array(ActionStep)),
  });
  const readableInput = Schema.is(Asked);
  export const canRender = (entry: ChatEntryOf<'tool'>): boolean => readableInput(entry.toolInput ?? {});
</script>

<script lang="ts">
  import Globe from '@lucide/svelte/icons/globe';
  import type { PageId } from '@tagma/server/browser/contract/wire/ids';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { diskAddress } from '$lib/features/checkout/files/disk.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import { Door } from '$lib/wire/Door.js';
  import { showPage } from './panes.js';

  let { entry }: { entry: ChatEntryOf<'tool'> } = $props();

  type Seen = { readonly id?: string; readonly url?: string; readonly title?: string };
  type Answered = {
    readonly status?: string;
    readonly page?: Seen | string;
    readonly path?: string;
    readonly mediaType?: string;
    readonly completed?: number;
    readonly stopped?: number | null;
  };

  const panes = SidePanes.use();
  const door = Door.use();
  const project = ProjectRung.Current.use().projectId;

  const asked = $derived((entry.toolInput ?? {}) as typeof Asked.Type);
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
<div class="grid min-w-0 gap-1.5 rounded-lg border bg-raised p-1.5" data-browser-tool={entry.toolName}>
  <div class="flex h-7 min-w-0 items-center gap-2 px-1.5">
    <Globe class="size-3.5 shrink-0 text-muted-foreground" />
    <FadeText class="shrink text-ui" text={seen?.title || seen?.url || asked.url || (page === null ? 'Page' : `Page ${page.slice(-8)}`)} />
    {#if what !== '' || (seen?.url && seen.title)}
      <FadeText class="flex-1 text-small text-muted-foreground" text={what || seen?.url} />
    {:else}
      <span class="flex-1"></span>
    {/if}
    {#if page !== null}
      <Button size="xs" variant="ghost" onclick={() => showPage(panes, { project, page: page as PageId })}>Show</Button>
    {/if}
  </div>
  {#if asked.steps !== undefined}
    <ol class="grid gap-1 px-1.5 pb-1.5">
      {#each asked.steps as step, index}
        <li class="flex min-w-0 items-center gap-2 text-small">
          <span class="shrink-0 text-muted-foreground">{index + 1}</span>
          <FadeText class="flex-1" text={[step.action, step.ref, step.key].filter(Boolean).join(' ')} />
          <span class="shrink-0 text-muted-foreground"
            >{answered.stopped === index + 1
              ? 'Dialog opened'
              : answered.completed !== undefined && index < answered.completed
                ? 'Done'
                : answered.status === undefined
                  ? ''
                  : 'Not run'}</span
          >
        </li>
      {/each}
    </ol>
  {/if}
  {#if frame !== null}
    <img src={frame} alt="What the page showed" class="max-h-96 w-full rounded-md object-contain object-left-top" />
  {/if}
</div>
