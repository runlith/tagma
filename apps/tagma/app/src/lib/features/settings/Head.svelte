<script lang="ts">
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { Component, Snippet } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import type { ColumnGroup } from '$lib/features/settings/column.js';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';

  let {
    icon: Icon,
    title,
    crumb,
    picker,
    current,
    scope,
    onpick,
    filter,
    layer,
  }: {
    icon: Component | null;
    title: string;
    crumb: string | null;
    picker: readonly ColumnGroup[] | null;
    current: string | null;
    scope: SettableScope;
    onpick: () => void;
    filter?: Snippet;
    layer?: Snippet;
  } = $props();

  const router = Router.use();

  function pick(section: string): void {
    onpick();
    void router.goto(settingsHref(router, section, scope));
  }
</script>

<header class="sticky top-0 z-10 border-b bg-background">
  <div class="page-reading flex h-12 items-center gap-2">
    {#if picker === null}
      {#if Icon}<Icon class="size-4 shrink-0 text-muted-foreground" />{/if}
      <h2 class="min-w-0 shrink truncate text-page">{title}</h2>
    {:else}
      <h2 class="flex min-w-0 shrink">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class="-ml-2 flex h-8 min-w-0 items-center gap-2 rounded-md px-2 transition-colors hover:bg-hover data-[state=open]:bg-selected"
            aria-label="{title} — choose a settings section"
          >
            {#if Icon}<Icon class="size-4 shrink-0 text-muted-foreground" />{/if}
            <span class="min-w-0 truncate text-page">{title}</span>
            <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="max-h-(--float-available-height) min-w-60 overflow-y-auto">
            {#each picker as group, index (group.title)}
              {#if index > 0}<DropdownMenu.Separator />{/if}
              <DropdownMenu.Group>
                <DropdownMenu.GroupHeading>{group.title}</DropdownMenu.GroupHeading>
                {#each group.sections as section (section.id)}
                  {@const here = section.id === current}
                  <DropdownMenu.Item icon={section.icon} aria-current={here ? 'page' : undefined} onSelect={() => pick(section.id)}>
                    {section.title}
                    {#snippet tail()}
                      {#if here}
                        <Check class="size-3.5 text-brand" />
                      {:else if section.count > 0}
                        <span class="stamp tabular text-muted-foreground">{section.count}</span>
                      {/if}
                    {/snippet}
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Group>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </h2>
    {/if}
    {#if crumb !== null}
      <ChevronRight class="size-3 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate text-ui text-muted-foreground">{crumb}</span>
    {:else}
      <span class="flex-1"></span>
    {/if}
    {#if filter}
      <div class="w-40 shrink-0">{@render filter()}</div>
    {/if}
    {#if layer}
      <div class="flex shrink-0 items-center">{@render layer()}</div>
    {/if}
  </div>
</header>
