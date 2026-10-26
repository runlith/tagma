<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import AppWindow from '@lucide/svelte/icons/app-window';
  import Monitor from '@lucide/svelte/icons/monitor';
  import { Router } from '@runlith/layer/Router';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import { stepRadio } from '$lib/features/settings/controls/radiogroup.js';
  import { scopeTitle } from '$lib/features/settings/scope.js';
  import type { SectionPlace } from '$lib/features/settings/section.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let {
    section,
    scope,
    scopes,
    place,
    project,
  }: {
    section: string;
    scope: SettableScope;
    scopes: readonly SettableScope[];
    place: SectionPlace | null;
    project: Project | null;
  } = $props();

  const router = Router.use();

  const TABS: readonly SettableScope[] = ['project', 'user'];

  const CHIP = 'flex h-6 items-center gap-1.5 rounded-md bg-selected px-2 text-small text-muted-foreground';
</script>

{#if place !== null}
  <Tooltip text={place === 'This browser' ? 'Remembered by this browser alone' : 'Decided once for this machine'}>
    <span class={CHIP}>
      {#if place === 'This browser'}<AppWindow class="size-3.5" />{:else}<Monitor class="size-3.5" />{/if}
      {place}
    </span>
  </Tooltip>
{:else if scopes.length > 1 && project !== null}
  <div class="flex items-center gap-2">
    <span class="text-small text-muted-foreground">Set for</span>
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <div
      role="radiogroup"
      aria-label="Settings layer"
      tabindex={-1}
      class="flex items-center gap-0.5 rounded-md bg-sunken p-0.5"
      onkeydown={stepRadio}
    >
      {#each TABS as tab (tab)}
        {@const here = tab === scope}
        <a
          role="radio"
          aria-checked={here}
          tabindex={here ? 0 : -1}
          href={settingsHref(router, section, tab)}
          class="max-w-40 truncate rounded-sm px-2 py-0.5 text-small transition-colors {here
            ? 'bg-raised text-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          {scopeTitle(tab, project)}
        </a>
      {/each}
    </div>
  </div>
{:else if scopes.length === 1}
  <Tooltip text={scope === 'user' ? 'Decided once for every project' : `Decided for ${scopeTitle(scope, project)} alone`}>
    <span class={CHIP}>{scopeTitle(scope, project)}</span>
  </Tooltip>
{/if}
