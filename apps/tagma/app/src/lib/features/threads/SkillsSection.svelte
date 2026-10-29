<script lang="ts">
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';
  import Group from '$lib/features/settings/Group.svelte';
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import { pick, rest, type SectionProps } from '$lib/features/settings/section.js';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import PathText from '$lib/shared/PathText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let { catalog, scope, project }: SectionProps = $props();

  const SOURCES = [
    'skills.project.enabled',
    'skills.directories.project',
    'skills.global.enabled',
    'skills.directories.global',
    'skills.rescan',
    'skills.own.enabled',
  ];
  const DERIVED = ['skills.disabled'];

  const served = SettingsRepo.use();
  const entries = $derived(catalog.entriesOf('skills'));

  type InventorySkill = {
    name: string;
    description: string;
    path: string | null;
    directory: string | null;
    scope: 'plugin' | 'global' | 'project' | 'built-in';
    plugin: string | null;
    enabled: boolean;
    replacedBy: 'plugin' | 'global' | 'project' | 'built-in' | null;
  };
  type Inventory = {
    skills: readonly InventorySkill[];
    contextFiles: readonly { path: string; name: string }[];
    rejected: readonly { path: string; reason: string }[];
  };

  let inventory = $state<Inventory | null>(null);
  let error = $state<string | null>(null);
  let reading = $state(false);
  let toggling = $state<string | null>(null);

  $effect(() => {
    void load(project?.id);
  });

  const offered = $derived(inventory?.skills.filter((skill) => skill.enabled).length ?? 0);
  const silenced = $derived((inventory?.skills.length ?? 0) - offered);

  const standsIn = (skill: InventorySkill): boolean =>
    inventory?.skills.some((entry) => entry.scope === 'built-in' && entry.name === skill.name && entry.replacedBy === skill.scope) ?? false;

  const REPLACER: Readonly<Record<InventorySkill['scope'], string>> = {
    project: "this project's skill",
    global: 'your own skill',
    plugin: "a plugin's skill",
    'built-in': 'a built-in skill',
  };

  const GROUPS = [
    { scope: 'project' as const, title: 'This project' },
    { scope: 'global' as const, title: 'Yours, everywhere' },
    { scope: 'plugin' as const, title: 'From plugins enabled here' },
    { scope: 'built-in' as const, title: 'Built into this server' },
  ];

  const switchedOff = (entry: InventorySkill): boolean => !entry.enabled && (entry.replacedBy === null || entry.scope === 'built-in');

  async function load(projectId: number | undefined): Promise<void> {
    error = null;
    if (projectId === undefined) {
      inventory = null;
      return;
    }
    try {
      inventory = (await served.inventory.key(projectId).refresh({ throwOnError: true })) ?? null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  async function toggle(skill: InventorySkill): Promise<void> {
    if (!project || !inventory) return;
    toggling = skill.name;
    try {
      const disabled = inventory.skills.filter(switchedOff).map((entry) => entry.name);
      const next = skill.enabled ? [...disabled, skill.name] : disabled.filter((name) => name !== skill.name);
      await catalog.write({ scope, key: 'skills.disabled', value: next });
      await load(project.id);
    } finally {
      toggling = null;
    }
  }

  async function reread(): Promise<void> {
    if (!project) return;
    reading = true;
    try {
      inventory = (await served.reloadSources.run(project.id, { throwOnError: true })) ?? inventory;
      await catalog.load();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      reading = false;
    }
  }
</script>

<div class="grid">
  <Group title="Skills in this checkout">
    {#snippet fact()}
      {#if inventory}
        <span class="tabular">{offered} offered{silenced > 0 ? ` · ${silenced} off` : ''}</span>
      {/if}
    {/snippet}
    {#snippet act()}
      {#if project}
        <Tooltip text="Walk the skill directories again now">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
            disabled={reading}
            onclick={() => void reread()}
          >
            Re-read
            {#if reading}<Waiting class="size-3" />{:else}<RefreshCw class="size-3" />{/if}
          </button>
        </Tooltip>
      {/if}
    {/snippet}

    {#if error}
      <p class="py-3 text-ui text-destructive">{error}</p>
    {:else if !project}
      <p class="py-3 text-ui text-muted-foreground">Open a project to see the skills its checkout offers.</p>
    {:else if inventory === null}
      <p class="py-3 text-ui text-muted-foreground">Reading the checkout…</p>
    {:else if inventory.skills.length === 0}
      <p class="py-3 text-ui text-muted-foreground">No skills discovered. They are read from the directories below.</p>
    {:else}
      {#each GROUPS as group (group.scope)}
        {@const found = inventory.skills.filter((skill) => skill.scope === group.scope)}
        {#if found.length > 0}
          <div>
            <p class="eyebrow pt-3 pb-1 text-muted-foreground">{group.title}</p>
            {#each found as skill (skill.path ?? skill.name)}
              <div class="flex items-center gap-6 border-t border-vein py-2" class:opacity-60={!skill.enabled}>
                <div class="grid min-w-0 flex-1 gap-0.5">
                  <span class="truncate text-ui font-medium">{skill.name}</span>
                  <Tooltip text={skill.description} class="block min-w-0">
                    <span class="block truncate text-small text-muted-foreground">
                      {skill.description}
                    </span>
                  </Tooltip>
                  {#if skill.plugin !== null}
                    <span class="stamp text-muted-foreground/70">{skill.plugin}</span>
                  {/if}
                  {#if skill.path}
                    <Tooltip text={skill.path} class="block min-w-0">
                      <PathText class="stamp text-muted-foreground/70" path={skill.path} />
                    </Tooltip>
                  {/if}
                </div>
                {#if skill.scope === 'built-in' && skill.replacedBy !== null}
                  <Tooltip text="Switched off in skills.disabled; {REPLACER[skill.replacedBy]} of the same name is offered in its place">
                    <span class="eyebrow shrink-0 text-muted-foreground"> Replaced </span>
                  </Tooltip>
                {:else if skill.scope === 'plugin' && skill.replacedBy !== null}
                  <Tooltip text="Not offered: {REPLACER[skill.replacedBy]} of the same name stands in its place">
                    <span class="eyebrow shrink-0 text-muted-foreground"> Replaced </span>
                  </Tooltip>
                {:else if skill.scope === 'built-in'}
                  <Tooltip
                    text={skill.enabled
                      ? 'Built into this server; always offered'
                      : 'Built into this server; switched off in skills.disabled'}
                  >
                    <span class="eyebrow shrink-0 text-muted-foreground"> {skill.enabled ? 'Always' : 'Off'} </span>
                  </Tooltip>
                {:else if standsIn(skill)}
                  <Tooltip
                    text="Offered in place of the built-in skill of this name, which skills.disabled switches off; remove the name there to give it back"
                  >
                    <span class="eyebrow shrink-0 text-muted-foreground"> Instead of built-in </span>
                  </Tooltip>
                {:else}
                  <SwitchControl
                    label="{skill.enabled ? 'Disable' : 'Enable'} {skill.name}"
                    value={skill.enabled}
                    disabled={toggling !== null}
                    onwrite={() => void toggle(skill)}
                  />
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/each}
    {/if}

    {#if inventory && inventory.rejected.length > 0}
      <div class="mt-2 grid gap-1 rounded-md bg-sunken px-3 py-2">
        {#each inventory.rejected as entry (entry.path)}
          <p class="text-small text-destructive"><span class="stamp">{entry.path}</span> — {entry.reason}</p>
        {/each}
      </div>
    {/if}
  </Group>

  <KeyCard title="Where skills come from" entries={pick(entries, SOURCES)} {catalog} {scope} {project} />

  {#if rest(entries, [...SOURCES, ...DERIVED]).length > 0}
    <KeyCard title="More" entries={rest(entries, [...SOURCES, ...DERIVED])} {catalog} {scope} {project} />
  {/if}
</div>
