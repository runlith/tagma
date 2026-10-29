<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import GitCompare from '@lucide/svelte/icons/git-compare';
  import Languages from '@lucide/svelte/icons/languages';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { Router } from '@runlith/layer/Router';
  import type { LanguageStanding } from '@tagma/server/translations/contract/wire/projection';
  import LensStrip from '$lib/features/graph/block/LensStrip.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import CatalogPicker from '$lib/features/settings/controls/CatalogPicker.svelte';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import ReadingFailed from '$lib/shared/ReadingFailed.svelte';
  import { agoSaid } from '$lib/shared/time.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import { languageName, widelyUsed } from './languages.js';
  import { type Standing, standingOf, type TranslationLens } from './Lens.svelte.js';

  let {
    lens,
    href,
    changes,
  }: {
    lens: TranslationLens;
    href: string | null;
    changes: (since: string) => void;
  } = $props();

  const router = Router.use();
  const notices = Notices.use();

  const language = $derived(lens.language() ?? '');
  const projection = $derived(lens.projection);
  const phase = $derived(lens.phase);
  const refusal = $derived(lens.refusal);
  const others = $derived(widelyUsed.filter((one) => !lens.languages.some((held) => held.language === one.tag)));

  const WORDS: Record<Exclude<Standing, 'current'>, string> = {
    translating: 'translating',
    outdated: 'outdated',
    failed: 'failed',
  };

  const parts = (count: number): string => `${count} ${count === 1 ? 'part' : 'parts'}`;

  function run(act: Promise<void>): void {
    act.catch((error: unknown) => notices.refusal(error));
  }
</script>

{#snippet tile(one: LanguageStanding)}
  {@const standing = standingOf(one)}
  {#if standing === 'translating'}
    <Waiting class="size-3 text-muted-foreground" />
  {:else}
    <span
      class={[
        'block size-2',
        standing === 'outdated' ? 'bg-status-stale' : standing === 'failed' ? 'bg-destructive' : 'bg-muted-foreground',
      ]}
    ></span>
  {/if}
{/snippet}

{#snippet stop()}
  {#if phase === 'translating'}
    <button
      type="button"
      class="flex items-center gap-1.5 text-small text-muted-foreground transition-colors hover:text-foreground"
      onclick={() => run(lens.stop())}
    >
      <span class="block size-2 bg-current"></span>Stop
    </button>
  {/if}
{/snippet}

<LensStrip word="Translation" leave="Show the original" {href} onleave={() => lens.leave()} end={stop}>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-small font-medium transition-colors hover:bg-hover data-[state=open]:bg-selected"
      aria-label="Language"
    >
      {languageName(language)}<ChevronDown class="size-3 text-muted-foreground" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" class="min-w-56">
      <DropdownMenu.Item icon={RefreshCw} onSelect={() => run(lens.update({ again: true }))}>Translate again</DropdownMenu.Item>
      {#if lens.languages.length > 0}
        <DropdownMenu.Separator />
        <DropdownMenu.Label>This block</DropdownMenu.Label>
        {#each lens.languages as one (one.language)}
          {@const standing = standingOf(one)}
          {#if one.language === language}
            <DropdownMenu.Item here onSelect={() => undefined}>
              {#snippet lead()}{@render tile(one)}{/snippet}
              {languageName(one.language)}
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item current={standing === 'current' ? null : WORDS[standing]} onSelect={() => run(lens.choose(one.language))}>
              {#snippet lead()}{@render tile(one)}{/snippet}
              {languageName(one.language)}
            </DropdownMenu.Item>
          {/if}
        {/each}
      {/if}
      <DropdownMenu.Separator />
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger icon={Languages}>Other language</DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent class="max-h-72 min-w-48 overflow-y-auto">
          <DropdownMenu.RadioGroup value={language} onValueChange={(next) => run(lens.choose(next))}>
            {#each others as one (one.tag)}
              <DropdownMenu.RadioItem value={one.tag}>{one.name}</DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <CatalogPicker
    label="Translation model"
    of="model"
    chip
    blank="Choose a model"
    value={projection?.model ?? ''}
    onwrite={(model) => run(lens.update({ model, again: true }))}
  />

  {#if projection !== null}
    {#if phase === 'translating'}
      <span class="flex items-center gap-2 text-small text-muted-foreground">
        <Waiting class="size-3" label="Translating" />Translating, {projection.translated} of {parts(projection.total)}
      </span>
    {:else if phase === 'outdated'}
      <span class="text-small text-status-stale">{parts(projection.changed)} changed since</span>
      <Button size="sm" onclick={() => run(lens.update())}>Update translation</Button>
      <button
        type="button"
        class="flex items-center gap-1 text-small text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => changes(projection.at)}
      >
        <GitCompare class="size-3" />What changed
      </button>
    {:else if phase === 'stopped'}
      <span class="text-small text-muted-foreground">Stopped at {projection.translated} of {parts(projection.total)}</span>
      <Button size="sm" onclick={() => run(lens.update())}>Translate the rest</Button>
    {:else if phase === 'failed'}
      <span class="stamp tabular text-muted-foreground/70">{projection.translated} of {parts(projection.total)}</span>
    {:else}
      <span class="stamp tabular text-muted-foreground/70">translated {agoSaid(projection.at)}</span>
    {/if}
  {/if}
</LensStrip>

{#snippet again()}
  <Button variant="outline" size="sm" onclick={() => run(lens.update())}><RefreshCw class="size-3.5" />Try again</Button>
{/snippet}

{#snippet settings()}
  <Button variant="outline" size="sm" href={settingsHref(router, 'translation', undefined, 'translation.model')}>
    Choose in Settings <span class="stamp text-muted-foreground">translation.model</span>
  </Button>
{/snippet}

{#if refusal !== undefined}
  <Callout
    tone="error"
    title={toldOf(refusal).text}
    note={refusal.reason}
    class="mt-3"
    actions={refusal.code === 'translation-model-missing' || refusal.code === 'invalid-selection' ? settings : undefined}
  />
{:else if projection !== null && phase === 'failed'}
  <Callout
    tone="error"
    title="Translation stopped at {projection.translated} of {parts(projection.total)}"
    note={projection.reason ?? undefined}
    class="mt-3"
    actions={again}
  />
{:else if lens.failure !== null}
  <div class="mt-3">
    <ReadingFailed failure={lens.failure} title="The translation could not be read" onRetry={() => lens.reread()} />
  </div>
{/if}
