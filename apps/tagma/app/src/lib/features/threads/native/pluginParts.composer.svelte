<script lang="ts">
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import { ComposerRefused, type ComposerSlashCommand } from '@runlith/chat-ui/composer';
  import { Effect } from 'effect';
  import { Door } from '$lib/wire/Door.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import { PluginActions } from '../../plugin-views/PluginActions.svelte.js';
  import PluginView from '../../plugin-views/PluginView.svelte';
  import type { ComposerFace } from '../../plugin-views/ui.js';
  import { ViewSets } from '../../plugin-views/ViewSets.svelte.js';
  import type { ChatHold } from '../ChatHold.svelte.js';
  import type { ThreadDraft } from '../Draft.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import type { SlotSurface } from './contribution.js';

  let {
    shown,
    chat,
    draft,
    writes,
    composer,
    surface,
    contributor,
  }: {
    shown: ShownThread;
    chat: ChatHold;
    draft: ThreadDraft;
    writes: ThreadWrites;
    composer: ComposerContributions;
    surface: SlotSurface;
    contributor: string;
  } = $props();

  type PluginActionSet = PluginActions['sets'][number];

  const ARGUMENTS = '$ARGUMENTS';
  const WORDS = [{ id: 'args', label: 'Words', optional: true }];

  const sets = ViewSets.use();
  const actions = PluginActions.use();
  const door = Door.use();

  const parts = $derived(sets.sets.flatMap((set) => set.composer.map((part) => ({ plugin: set.plugin, view: part.view }))));
  const offered = $derived(
    actions.sets
      .filter((set) => set.projects.includes(shown.projectId))
      .flatMap((set) => set.commands.map((command) => ({ set, command }))),
  );

  const insert = (text: string): void => {
    const now = draft.text;
    const at = surface.prompt.selection();
    const from = at?.from ?? now.length;
    draft.setText(now.slice(0, from) + text + now.slice(at?.to ?? now.length));
    surface.prompt.caret(from + text.length);
  };

  const face: ComposerFace = {
    thread: {
      get id() {
        return shown.id;
      },
      get projectId() {
        return shown.projectId;
      },
      get status() {
        return chat.session?.life ?? null;
      },
    },
    draft: {
      get text() {
        return draft.text;
      },
      setText: (text) => draft.setText(text),
      insert,
      attach: async (files) => void (await draft.attach(files)),
    },
    send: () => writes.send(),
  };

  const ran = (set: PluginActionSet, action: string, args: string) =>
    Effect.tryPromise({
      try: () =>
        door.perform(
          'run_plugin_action',
          { plugin: set.plugin, action, threadId: shown.id ?? undefined, args },
          { project: String(shown.projectId) },
        ),
      catch: (error) => new ComposerRefused({ message: toldOf(error).text }),
    }).pipe(
      Effect.map(({ said }) => {
        if (said !== null) draft.setText(said);
      }),
    );

  const slash = (set: PluginActionSet, command: PluginActionSet['commands'][number]): ComposerSlashCommand => ({
    name: `${set.plugin}-${command.name}`,
    description: `${command.description} · ${set.title}`,
    order: 80,
    ...('action' in command
      ? { fields: WORDS, run: ({ values }) => ran(set, command.action, values?.args ?? '') }
      : command.text.includes(ARGUMENTS)
        ? { fields: WORDS, run: ({ values }) => Effect.sync(() => insert(command.text.replaceAll(ARGUMENTS, values?.args ?? ''))) }
        : { run: () => Effect.sync(() => insert(command.text)) }),
  });

  $effect.pre(() => {
    const releases = offered.map(({ set, command }) => composer.command(contributor, slash(set, command)));
    return () => {
      for (const release of releases) release();
    };
  });

  $effect.pre(() => (parts.length === 0 ? undefined : composer.chip(contributor, { id: 'plugins', region: 'dock', body: drawn })));
</script>

{#snippet drawn()}
  <div class="flex flex-col gap-1.5 pb-1.5">
    {#each parts as part (`${part.plugin}\n${part.view}`)}
      <PluginView plugin={part.plugin} view={part.view} projectId={shown.projectId} threadId={shown.id} props={face} />
    {/each}
  </div>
{/snippet}
