<script lang="ts">
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import { Seam } from '@runlith/seam/Seam.svelte';
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import type { Snippet } from 'svelte';
  import type { ColumnGroup } from '$lib/features/settings/column.js';
  import type { SettingsParts } from '$lib/features/settings/parts.svelte.js';
  import { Router } from '@runlith/layer/Router';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import { Seams } from '$lib/shared/seams/Seams.svelte.js';
  import { SETTINGS_SEAM } from './seams.js';

  let {
    groups,
    active,
    scope,
    parts,
    searching,
    filter,
    onpick,
    onCollapse,
  }: {
    groups: readonly ColumnGroup[];
    active: string | null;
    scope: SettableScope;
    parts: SettingsParts;
    searching: boolean;
    filter: Snippet;
    onpick: () => void;
    onCollapse: () => void;
  } = $props();

  const seams = Seams.use();
  const router = Router.use();
  const seam = new Seam(seams.seam(SETTINGS_SEAM), {
    onCommit: (size) => seams.set(SETTINGS_SEAM, size),
    onCollapse: () => onCollapse(),
  });

  let aside = $state<HTMLElement | null>(null);
  let list = $state<HTMLElement | null>(null);
  const drawn = $derived(groups.length > 0);

  $effect(() => {
    void active;
    if (drawn) list?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  });

  function links(): HTMLElement[] {
    return list === null ? [] : [...list.querySelectorAll<HTMLElement>('[data-column-link]')];
  }

  function fieldKeys(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' || event.defaultPrevented) return;
    event.preventDefault();
    links()[0]?.focus();
  }

  function listKeys(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const all = links();
    const at = all.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    let next: HTMLElement | null | undefined;
    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        next = all[at + 1];
        break;
      case 'ArrowUp':
      case 'k':
        next = at === 0 ? aside?.querySelector('input') : all[at - 1];
        break;
      case 'Home':
        next = all[0];
        break;
      case 'End':
        next = all[all.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    next?.focus();
  }
</script>

<aside
  bind:this={aside}
  data-settings-column
  class="flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-chrome"
  style:width="{seam.size}px"
  aria-label="Settings sections"
>
  <div class="flex h-12 shrink-0 items-center border-b pr-3 pl-4">
    <h1 class="eyebrow text-muted-foreground">Settings</h1>
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-1 pt-1.5">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="mx-3 shrink-0" onkeydown={fieldKeys}>{@render filter()}</div>

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <nav bind:this={list} class="grid min-h-0 flex-1 content-start overflow-y-auto px-3 pb-6" aria-label="Sections" onkeydown={listKeys}>
      {#each groups as group (group.title)}
        <p class="eyebrow px-2 pt-3 pb-1 text-muted-foreground/70">{group.title}</p>
        {#each group.sections as section (section.id)}
          {@const here = !searching && section.id === active}
          <a
            data-column-link
            href={settingsHref(router, section.id, scope)}
            aria-current={here ? 'page' : undefined}
            class={[
              'flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-ui transition-colors',
              here ? 'bg-selected text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
            ]}
            onclick={onpick}
          >
            <section.icon class="size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{section.title}</span>
            {#if section.count > 0}
              <span class="stamp tabular shrink-0 text-muted-foreground/70">
                {section.count}<span class="sr-only">{searching ? ' matching keys' : ' keys set on this layer'}</span>
              </span>
            {/if}
          </a>
          {#if here && parts.list.length > 1}
            <div class="mt-0.5 mb-1 ml-4 grid border-l border-vein pl-3">
              {#each parts.list as part, index (part)}
                {@const current = index === parts.current}
                <button
                  type="button"
                  data-column-link
                  aria-current={current ? 'location' : undefined}
                  class={[
                    'relative h-6 truncate rounded-sm px-2 text-left text-small transition-colors',
                    current ? 'text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
                  ]}
                  onclick={() => parts.reach(part)}
                >
                  {#if current}<span class="absolute top-1 -left-3 h-4 w-0.5 rounded-full bg-brand"></span>{/if}
                  {part.title}
                </button>
              {/each}
            </div>
          {/if}
        {/each}
      {:else}
        <p class="px-2 py-2 text-small text-muted-foreground">No section or key matches.</p>
      {/each}
    </nav>
  </div>
</aside>

<SeamHandle {seam} label="Resize the settings column" />
