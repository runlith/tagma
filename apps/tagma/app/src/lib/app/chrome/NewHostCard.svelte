<script lang="ts">
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import type { HostEnding, NewHost } from '@tagma/server/installation/contract/wire/newHost';
  import { Button } from '$lib/shared/ui/button/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { buildName, endingGroups, endsSaid, namesAll, type Said } from './newHost.js';
  import { Standing } from './Standing.svelte.js';

  const standing = Standing.use();

  let { needed, place, later = () => standing.putOff() }: { needed: NewHost; place: 'notice' | 'popover'; later?: () => void } = $props();
  const workspace = Workspace.use();

  let shown = $state(false);

  const ends = $derived(needed.ends);
  const running = $derived(standing.machine?.server.installation?.build ?? null);
  const back = $derived(needed.back === null ? null : standing.offer(needed.back));
  const update = $derived(needed.cause === 'update');

  const title = $derived(
    update
      ? `${needed.build === null ? 'Tagma' : buildName(needed.build)} is ready`
      : `${needed.host === null ? 'Another build' : buildName(needed.host)} holds your terminals`,
  );

  const verb = $derived(update ? 'updating' : 'restarting the host');
  const opening = $derived.by((): Said[] => {
    if (update) return [{ text: 'It needs a new execution host, so ', strong: false }];
    const self = needed.build === null ? 'this version' : buildName(needed.build);
    return [{ text: `Its execution host does not take ${self}, so `, strong: false }];
  });
  const closing = $derived(
    update
      ? running === null
        ? ''
        : ` Until then you keep working on ${buildName(running)}.`
      : ' Until then no terminal or command starts.',
  );

  const said = $derived.by((): Said[] => {
    if (ends === null) return [...opening, { text: `${verb} ends everything it runs.`, strong: false }];
    if (ends.length === 0) return [...opening, { text: `${verb} ends nothing: nothing runs in it.`, strong: false }];
    if (shown) return [...opening, { text: `${verb} ends these.`, strong: false }];
    return [...opening, { text: `${verb} ends `, strong: false }, ...endsSaid(ends), { text: '.', strong: false }];
  });

  const act = $derived(
    `${update ? 'Update' : 'Restart host'}${ends === null ? ' and end all' : ends.length === 0 ? '' : ` and end ${ends.length}`}`,
  );
  const more = $derived(ends !== null && ends.length > 0 && !namesAll(ends));
  const groups = $derived(ends === null ? [] : endingGroups(ends));
  const busy = $derived(standing.acting !== null);

  const projectOf = (ending: HostEnding): string => {
    const project = ending.projectId === null ? null : (workspace.projects.find((one) => one.id === ending.projectId)?.name ?? null);
    return [ending.thread === null ? null : 'agent', project].filter((part) => part !== null).join(', ');
  };

  const replace = (): void => void standing.restart('replace');
  const open = (): void => {
    if (back !== null) void standing.update(back.id);
  };
</script>

{#snippet note()}
  <p class="text-small wrap-anywhere text-muted-foreground" data-new-host-note>
    {#each [...said, { text: closing, strong: false }] as part, index (index)}
      {#if part.strong}<b class="font-medium text-foreground">{part.text}</b>{:else}{part.text}{/if}
    {/each}
  </p>
{/snippet}

{#snippet list()}
  {#if shown && groups.length > 0}
    <div class="grid max-h-48 grid-cols-1 gap-0.5 overflow-y-auto rounded-md bg-sunken px-2 py-1.5" data-new-host-list>
      {#each groups as group (group.title)}
        <span class="pt-1 text-meta text-muted-foreground first:pt-0">{group.title}</span>
        {#each group.rows as ending (ending.execution)}
          <span class="stamp grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-small">
            <FadeText text={ending.title} />
            <span class="text-muted-foreground">{projectOf(ending)}</span>
          </span>
        {/each}
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet actions(putsOff: boolean)}
  <Button size="xs" disabled={busy} onclick={replace} data-new-host-act>{act}</Button>
  {#if back !== null}
    <Button variant="outline" size="xs" disabled={busy} onclick={open}>Open {back.label === '' ? back.title : back.label}</Button>
  {/if}
  {#if putsOff}
    <Button variant="ghost" size="xs" class="text-muted-foreground" onclick={later}>Later</Button>
  {/if}
  {#if more}
    <Button variant="ghost" size="xs" class="text-muted-foreground" aria-expanded={shown} onclick={() => (shown = !shown)}>
      {shown ? 'Show less' : 'Show all'}
    </Button>
  {/if}
{/snippet}

{#if place === 'notice'}
  <Callout
    tone="plain"
    {title}
    onDismiss={later}
    dismissLabel="Later"
    class="bg-popover text-popover-foreground shadow-float"
    actions={laterActions}
  >
    {@render note()}
    {@render list()}
  </Callout>
{:else}
  <div
    class={cn('grid gap-1.5 rounded-lg border px-3 py-2', update ? 'border-status-in-work/30 bg-status-in-work/10' : 'border-border')}
    data-new-host={needed.cause}
  >
    <span class="font-semibold">{title}</span>
    {@render note()}
    {@render list()}
    <div class="-ml-1 flex flex-wrap items-center gap-1">{@render actions(false)}</div>
  </div>
{/if}

{#snippet laterActions()}
  {@render actions(true)}
{/snippet}
