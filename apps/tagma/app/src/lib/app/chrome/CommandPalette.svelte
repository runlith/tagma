<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Globe from '@lucide/svelte/icons/globe';
  import { tick } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { useDialogHandle } from '@runlith/primitives/dialog-handle-context.svelte';
  import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
  import { FileOpener } from '$lib/features/checkout/files/FileOpener.svelte.js';
  import { Tabs } from '$lib/features/checkout/files/Tabs.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import type { ActionEnv } from '$lib/features/workspace/action.js';
  import { PluginActions } from '$lib/features/plugins/PluginActions.svelte.js';
  import { ActionRegistry } from './ActionRegistry.js';
  import { ASK_VALUE, type FilesPort, PaletteModel, type Row as PaletteRow, SHOWN } from '$lib/features/palette/Palette.svelte.js';
  import type { GroupId } from '$lib/app/panes/palette.js';
  import { CHIPS, GROUP_TITLES, nextChip } from '$lib/features/palette/query.js';
  import { PaletteRepo } from '$lib/features/palette/Repo.js';
  import Row from '$lib/features/palette/Row.svelte';
  import { landingScope } from '$lib/features/settings/scope.js';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import { Asking } from '$lib/features/threads/Asking.js';
  import { projectOpen, settingsHref } from '$lib/features/workspace/address.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { Door } from '$lib/wire/Door.js';
  import * as Command from '$lib/shared/ui/command/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import ViewTab from '$lib/shared/ui/ViewTab.svelte';
  import { Keymap } from '../keys/Keymap.svelte.js';

  const PREFIX_HINTS = [
    { sign: '>', word: 'actions' },
    { sign: '@', word: 'threads' },
    { sign: '#', word: 'blocks' },
    { sign: '?', word: 'ask' },
  ] as const;

  const ASK_REQUEST = 'Answer with links to the threads, blocks and commits you found and rely on.';

  let { group, query, beside: filesBeside = false }: { group?: GroupId; query?: string; beside?: boolean } = $props();

  const dialog = useDialogHandle();
  const keymap = Keymap.use();
  const app = App.current();
  const tagma = Asking.use();
  const notices = Notices.use();
  const shell = shellActs(ShellOps.use(), notices);
  const workspace = Workspace.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const surfaces = SurfaceRegistry.use();

  const env = (): ActionEnv => ({
    project: workspace.contextProject,
    routeProject: projectOpen(router) ? (router.params.project ?? null) : null,
    surface: projectOpen(router) ? surfaces.of(router.routeId) : null,
    goto: (href) => void router.goto(href),
    resolve: (key) => app.resolve(key),
  });

  const opener = FileOpener.use();
  const graphAim = GraphRung.Source.use();

  let reach = $state.raw<{
    readonly tabs: Tabs;
    readonly checkout: Checkout;
    readonly tags: TagCatalog;
    readonly projectId: number;
  } | null>(null);

  $effect.pre(() => {
    const aim = graphAim();
    if (aim === undefined) {
      reach = null;
      return;
    }
    const held = app.hold(GraphRung, aim);
    reach = {
      tabs: app.resolve(Tabs, held.scope),
      checkout: app.resolve(Checkout, held.scope),
      tags: app.resolve(TagCatalog, held.scope),
      projectId: aim.projectId,
    };
    return () => held.release();
  });

  const files: FilesPort = {
    aim: () => {
      const here = reach;
      const row = here?.checkout.row ?? null;
      return here === null || row === null
        ? null
        : { projectId: here.projectId, root: row.rootId, rootPath: row.path, recent: here.tabs.recent };
    },
  };

  const pluginActions = PluginActions.use();
  const declared = ActionRegistry.use().of(app);

  const model = new PaletteModel(
    workspace,
    () => reach?.tags ?? null,
    PaletteRepo.use(),
    SettingsRepo.use(),
    () => [...declared, ...pluginActions.actions],
    env,
    files,
    Door.use(),
  );

  $effect.pre(() => {
    if (group !== undefined) model.chip = group;
  });

  $effect.pre(() => {
    if (query !== undefined) model.query = query;
  });

  const text = $derived(model.text);
  const asking = $derived(model.asking);
  const rows = $derived(model.sections.flatMap((section) => section.rows));
  const ask = $derived<PaletteRow | null>(text === '' ? null : { kind: 'ask', value: ASK_VALUE, text });
  const everything = $derived(ask === null ? rows : [...rows, ask]);
  const busy = $derived(model.threads.loading || model.blocks.loading || model.commits.loading);
  const reachable = $derived((model.focus === null || model.focus === 'threads') && model.project !== null);
  const quiet = $derived(
    model.sections.every((section) => section.rows.length === 0 && section.notes.length === 0 && section.failure === null),
  );
  const nothing = $derived(text !== '' && !busy && quiet);
  const values = $derived([
    ...model.sections.flatMap((section) => [
      ...section.rows.map((row) => row.value),
      ...(section.showAll === null ? [] : [`expand:${section.group}`]),
      ...(section.more ? [`more:${section.group}`] : []),
    ]),
    ...(ask === null ? [] : [ask.value]),
  ]);

  let selected = $state('');
  let moved = false;

  $effect(() => {
    void model.query;
    void model.chip;
    moved = false;
  });

  $effect(() => {
    const first = values[0] ?? '';
    if (!moved || !values.includes(selected)) selected = first;
  });

  function expand(group: GroupId): void {
    model.expand(group);
    const revealed = model.sections.find((section) => section.group === group)?.rows[SHOWN]?.value;
    if (revealed !== undefined) void tick().then(() => (selected = revealed));
  }

  function more(group: GroupId): void {
    const last = model.sections.find((section) => section.group === group)?.rows.at(-1)?.value;
    if (last !== undefined) selected = last;
    model.more(group);
  }

  const standing = $derived(everything.find((row) => row.value === selected) ?? null);
  const besideable = $derived(standing !== null && beside(standing) !== null);

  function beside(row: PaletteRow): string | null {
    if (row.kind !== 'thread') return null;
    return workspace.activeId !== null && row.hit.project?.id === workspace.activeId ? row.hit.threadId : null;
  }

  function open(row: PaletteRow, sideways = false): void {
    const project = model.project;
    if (row.kind === 'ask') {
      void askAgent();
      return;
    }
    if (row.kind === 'action' && (row.action.disabled?.(env()) ?? false)) return;
    dialog.close();
    if (row.kind === 'project') {
      if (row.project.id !== workspace.activeId) void shell.openProject(row.project.id, 'palette');
      return;
    }
    if (row.kind === 'file') {
      void opener.open(
        { path: row.hit.path, line: row.line, column: row.column },
        { from: files.aim()?.rootPath, beside: filesBeside ? {} : undefined },
      );
      return;
    }
    if (row.kind === 'action') {
      void Promise.resolve(row.action.run(env())).catch((error: unknown) => notices.refusal(error));
      return;
    }
    const where = row.kind === 'thread' ? (row.hit.project?.name ?? project?.name) : project?.name;
    if (where === undefined) return;
    if (row.kind === 'thread') {
      const projectId = row.hit.project?.id ?? project?.id;
      if (projectId === undefined) return;
      void shell.openThread({ projectId, threadId: row.hit.threadId }, sideways ? 'beside' : 'main');
    } else if (row.kind === 'block') void router.goto(addresses.block(row.hit.name, { project: where }));
    else if (row.kind === 'commit') void router.goto(addresses.commit(row.commit.sha, where));
    else void router.goto(settingsHref(router, row.entry.section, landingScope(row.entry), row.entry.id));
  }

  async function askAgent(): Promise<void> {
    const project = model.project;
    if (text === '' || project === null) return;
    const question = text;
    dialog.close();
    await tagma.ask({ projectId: project.id }, `${question}\n\n${ASK_REQUEST}`);
  }

  function toggleReach(): void {
    model.reach = model.reach === 'all' ? 'project' : 'all';
  }

  function onKeys(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      model.chip = nextChip(model.chip, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.altKey && event.code === 'KeyP' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      if (reachable) toggleReach();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') moved = true;
    if (event.key !== 'Enter' || event.isComposing) return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      void askAgent();
    } else if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (standing !== null) open(standing, true);
    }
  }
</script>

<Command.Root
  bind:value={selected}
  onkeydowncapture={onKeys}
  class="fixed top-1/2 left-1/2 h-[72vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 border outline-none sm:max-w-2xl"
>
  <Dialog.Header class="sr-only">
    <Dialog.Title>Find or ask</Dialog.Title>
    <Dialog.Description>Search threads, blocks, commits, settings and actions, or ask Tagma</Dialog.Description>
  </Dialog.Header>
  <Command.Input placeholder="Find or ask…" bind:value={model.query} />
  <div class="flex items-center gap-0.5 px-2 pt-1.5 pb-1">
    <div class="flex items-center gap-1" role="tablist" aria-label="Group">
      {#each CHIPS as chip (chip)}
        <ViewTab
          selected={model.chip === chip}
          tabindex={-1}
          data-palette-chip={chip}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => (model.chip = chip)}
        >
          {chip === 'all' ? 'All' : GROUP_TITLES[chip]}
        </ViewTab>
      {/each}
    </div>
    {#if reachable}
      <button
        type="button"
        tabindex="-1"
        aria-pressed={model.reach === 'all'}
        aria-keyshortcuts="Alt+P"
        class={[
          'ml-auto flex h-6 items-center gap-1.5 rounded-md border px-2 text-small transition-colors',
          model.reach === 'all'
            ? 'border-input bg-selected text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground',
        ]}
        data-palette-reach
        onmousedown={(event) => event.preventDefault()}
        onclick={toggleReach}
      >
        <Globe class="size-3.5" />
        All projects
        <Kbd chord={keymap.spell({ ...keymap.bare('KeyP'), alt: true })} size="sm" />
      </button>
    {/if}
  </div>
  <Command.List class="max-h-none min-h-0 flex-1 border-t px-1 pb-1">
    {#each model.sections as section (section.group)}
      <div class="flex items-baseline gap-2 px-3 pt-3 pb-1 text-muted-foreground" data-palette-group={section.group}>
        <span class="eyebrow">{section.title}</span>
        {#if section.count !== null}<span class="stamp tabular">{section.count}</span>{/if}
      </div>
      <Command.Group class="py-0">
        {#each section.rows as row (row.value)}
          <Row {row} tags={reach?.tags ?? null} projectId={model.project?.id ?? null} env={env()} onSelect={() => open(row)} />
        {/each}
        {#if section.showAll !== null}
          <Command.Item
            value={`expand:${section.group}`}
            onSelect={() => expand(section.group)}
            class="gap-2 px-3 py-1.5 text-small text-muted-foreground"
            data-palette-show-all={section.group}
          >
            <ChevronDown class="size-3.5 shrink-0" />
            <span>{section.showAll}</span>
          </Command.Item>
        {/if}
        {#if section.more}
          <Command.Item
            value={`more:${section.group}`}
            disabled={section.loading}
            onSelect={() => more(section.group)}
            class="gap-2 px-3 py-1.5 text-small text-muted-foreground"
            data-palette-more={section.group}
          >
            <ChevronDown class="size-3.5 shrink-0" />
            <span>{section.loading ? 'Loading…' : 'Load more'}</span>
          </Command.Item>
        {/if}
      </Command.Group>
      {#each section.notes as note (note)}
        <p class="px-3 py-1 text-small text-muted-foreground" data-palette-note>{note}</p>
      {/each}
      {#if section.failure !== null}
        <p class="flex items-start gap-1.5 px-3 py-1 text-small text-muted-foreground" data-palette-failure={section.group}>
          <CircleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <span>Could not search {section.title.toLowerCase()}: {section.failure}</span>
        </p>
      {/if}
    {/each}

    {#if busy && quiet}
      <p class="px-6 pt-10 pb-6 text-center text-ui text-muted-foreground">Searching…</p>
    {/if}

    {#if nothing}
      <div class="px-6 pt-10 pb-6 text-center">
        <p class="text-ui text-muted-foreground">Nothing matches “{text}”.</p>
        <p class="mt-1.5 text-small text-muted-foreground">
          Try fewer words, narrow blocks with <code class="stamp">tag:</code> or <code class="stamp">status:</code>, or ask Tagma.
        </p>
      </div>
    {/if}

    {#if text === '' && !asking && model.sections.length === 0}
      <p class="px-6 py-12 text-center text-ui text-muted-foreground">
        Type to search {model.focus === null ? 'everything' : GROUP_TITLES[model.focus].toLowerCase()}.
      </p>
    {/if}

    {#if asking && ask === null}
      <p class="px-6 py-12 text-center text-ui text-muted-foreground">Type a question, and Tagma answers in a new thread.</p>
    {/if}

    {#if ask !== null}
      <div class="mx-2 mt-2 border-t pt-1"></div>
      <Command.Group class="py-0">
        <Row row={ask} tags={reach?.tags ?? null} projectId={model.project?.id ?? null} env={env()} onSelect={() => open(ask)} />
      </Command.Group>
    {/if}
  </Command.List>

  <div class="-mx-1 -mb-1 flex items-center justify-between gap-3 border-t bg-sunken/50 px-3 py-2 text-small text-muted-foreground">
    <div class="hidden min-w-0 items-center gap-3 md:flex">
      {#each PREFIX_HINTS as hint (hint.sign)}
        <span class="flex items-center gap-1.5"><Kbd chord={hint.sign} size="sm" />{hint.word}</span>
      {/each}
    </div>
    <div class="flex shrink-0 items-center gap-3">
      <span class="flex items-center gap-1.5"><Kbd chord={keymap.spell(keymap.bare('Enter'))} size="sm" />open</span>
      {#if besideable}<span class="flex items-center gap-1.5"
          ><Kbd chord={keymap.spell({ ...keymap.bare('Enter'), alt: true })} size="sm" />beside</span
        >{/if}
      <span class="flex items-center gap-1.5"><Kbd chord={keymap.spell(keymap.mod('Enter'))} size="sm" />ask</span>
      <span class="flex items-center gap-1.5"><Kbd chord={keymap.spell(keymap.bare('Tab'))} size="sm" />group</span>
    </div>
  </div>
</Command.Root>
