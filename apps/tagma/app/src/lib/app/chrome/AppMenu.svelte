<script lang="ts">
  import Coffee from '@lucide/svelte/icons/coffee';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import PanelTop from '@lucide/svelte/icons/panel-top';
  import Settings from '@lucide/svelte/icons/settings';
  import SunMoon from '@lucide/svelte/icons/sun-moon';
  import UserRound from '@lucide/svelte/icons/user-round';
  import { AWAKE_MODES, type AwakeMode } from '@tagma/server/power/contract/wire/power';
  import { Router } from '@runlith/layer/Router';
  import PointView from '@runlith/layer/svelte/PointView.svelte';
  import type { Snippet } from 'svelte';
  import { Theme, type ThemeChoice } from '$lib/shared/Theme.svelte.js';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Badge from '$lib/shared/ui/Badge.svelte';
  import { RAIL_HERE, RAIL_IDLE, RAIL_ITEM } from '$lib/shared/ui/rail.js';
  import { cn } from '$lib/shared/utils.js';
  import { MenuParts, MenuSignal } from '$lib/shared/window/parts.js';
  import { Awake } from '$lib/features/power/Awake.svelte.js';
  import { ProjectStrip, STRIP_VIEWS, type StripView } from '$lib/features/projects/Strip.svelte.js';

  const awake = Awake.use();
  const strip = ProjectStrip.use();
  const theme = Theme.use();
  const router = Router.use();
  const keymap = Keymap.use();
  const parts = MenuParts.use();
  const signal = MenuSignal.use();

  const waiting = $derived(signal.waiting);

  const VIEW_LABEL: Record<StripView, string> = { dock: 'Dock', tabs: 'Tabs' };

  const AWAKE_LABEL: Record<AwakeMode, string> = {
    'while-working': 'While working',
    always: 'Always',
    off: 'Off',
  };

  const THEMES: readonly { mode: ThemeChoice; label: string }[] = [
    { mode: 'system', label: 'System' },
    { mode: 'light', label: 'Light' },
    { mode: 'dark', label: 'Dark' },
  ];
</script>

{#snippet before(list: Snippet)}
  <DropdownMenu.Separator />
  {@render list()}
{/snippet}

{#snippet after(list: Snippet)}
  {@render list()}
  <DropdownMenu.Separator />
{/snippet}

<DropdownMenu.Root>
  <Tooltip text={waiting ? 'Menu, your account needs you' : 'Menu'} side="right">
    <DropdownMenu.Trigger
      class={cn(RAIL_ITEM, router.routeId === '/settings' ? RAIL_HERE : RAIL_IDLE, waiting && 'text-foreground')}
      aria-label={waiting ? 'Menu, your account needs you' : 'Menu'}
    >
      <Badge dot={waiting} tone="open" class="top-1.5 right-1.5"><UserRound class="size-4" /></Badge>
    </DropdownMenu.Trigger>
  </Tooltip>
  <DropdownMenu.Content side="right" align="end" class="min-w-60">
    <PointView point={parts} props={{}} only={(part) => part.place === 'head'} frame={after} />
    <DropdownMenu.Item icon={Settings} keys={keymap.spell('settings.open')} onSelect={() => void router.goto(settingsHref(router))}>
      Settings
    </DropdownMenu.Item>
    <PointView point={parts} props={{}} only={(part) => part.place === 'go'} />
    <DropdownMenu.Separator />
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger icon={SunMoon} current={THEMES.find((option) => option.mode === theme.choice)?.label}>
        Theme
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent class="min-w-36">
        <DropdownMenu.RadioGroup value={theme.choice} onValueChange={(next) => theme.choose(next as ThemeChoice)}>
          {#each THEMES as option (option.mode)}
            <DropdownMenu.RadioItem value={option.mode} closeOnSelect={false}>{option.label}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger icon={Coffee} current={awake.standing === null ? null : AWAKE_LABEL[awake.standing.mode]}>
        Keep awake
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent class="min-w-44">
        <DropdownMenu.RadioGroup value={awake.standing?.mode} onValueChange={(next) => void awake.choose(next as AwakeMode)}>
          {#each AWAKE_MODES as mode (mode)}
            <DropdownMenu.RadioItem value={mode} disabled={awake.choosing !== null}>{AWAKE_LABEL[mode]}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
        {#if awake.problem !== null}
          <DropdownMenu.Separator />
          <DropdownMenu.Note tone="destructive" role="alert" text={awake.problem} />
        {/if}
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    {#if strip.visible}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger icon={strip.view === 'dock' ? PanelLeft : PanelTop} current={VIEW_LABEL[strip.view]}>
          Projects
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent class="min-w-36">
          <DropdownMenu.RadioGroup value={strip.view} onValueChange={(next) => strip.show(next as StripView)}>
            {#each STRIP_VIEWS as view (view)}
              <DropdownMenu.RadioItem value={view} closeOnSelect={false}>{VIEW_LABEL[view]}</DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    {/if}
    <PointView point={parts} props={{}} only={(part) => part.place === 'foot'} frame={before} />
  </DropdownMenu.Content>
</DropdownMenu.Root>
