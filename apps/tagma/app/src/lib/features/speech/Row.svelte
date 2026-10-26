<script lang="ts">
  import type { Snippet } from 'svelte';
  import { foundReader } from '$lib/features/settings/found.js';
  import { Router } from '@runlith/layer/Router';
  import { scopeLock } from '$lib/features/settings/scope.js';
  import Told from '$lib/shared/Told.svelte';
  import type { Told as Telling } from '$lib/wire/told.js';
  import type { Place } from './values.js';

  let {
    title,
    hint,
    problem,
    place,
    settings = [],
    children,
  }: {
    title: string;
    hint?: string | Snippet;
    problem?: string | Telling | null;
    place?: Place;
    settings?: readonly string[];
    children: Snippet;
  } = $props();

  const router = Router.use();

  const entries = $derived(place === undefined ? [] : place.catalog.entries.filter((entry) => settings.includes(entry.id)));
  const locked = $derived(
    place === undefined
      ? undefined
      : entries.map((entry) => scopeLock(router, entry, place.scope, place.project)).find((lock) => lock !== undefined),
  );
  const busy = $derived(place !== undefined && place.catalog.busyKey !== null && settings.includes(place.catalog.busyKey));
  const outcome = $derived(
    place === undefined ? undefined : settings.map((id) => place.catalog.outcomes[id]).find((one) => one !== undefined),
  );
  const readFound = foundReader();
  const found = $derived.by(() => {
    const key = readFound();
    return key !== null && settings.includes(key);
  });
</script>

<div
  class={['group/speech -mx-3 rounded-md px-3 transition-colors duration-500', found && 'bg-selected']}
  data-setting={settings.length > 0 ? settings.join(' ') : undefined}
>
  <div class="grid gap-x-6 gap-y-2 border-t border-vein py-3 group-first/speech:border-t-0 @xl/settings:grid-cols-[minmax(0,1fr)_auto]">
    <div class="grid min-w-0 gap-1">
      <span class="text-ui font-medium">{title}</span>
      {#if typeof hint === 'string'}
        <p class="text-small leading-relaxed text-muted-foreground">{hint}</p>
      {:else if hint}
        <p class="text-small leading-relaxed text-muted-foreground">{@render hint()}</p>
      {/if}
      {#if typeof problem === 'string'}
        <p class="text-small leading-relaxed text-destructive">{problem}</p>
      {:else if problem}
        <Told told={problem} class="text-destructive" />
      {/if}
      {#if outcome?.kind === 'refused'}
        <div class="text-destructive" role="alert"><Told told={outcome.told} /></div>
      {:else if outcome?.kind === 'saved'}
        <p class="text-small text-status-done">Saved ✓</p>
      {/if}
      {#if locked}
        <p class="text-small text-muted-foreground">
          Decided {locked.decided} ·
          <a class="underline underline-offset-4 hover:text-foreground" href={locked.href}>{locked.label}</a>
        </p>
      {/if}
    </div>
    <fieldset class="m-0 grid w-72 min-w-0 max-w-full content-start gap-1.5 border-0 p-0" disabled={busy || locked !== undefined}>
      {@render children()}
    </fieldset>
  </div>
</div>
