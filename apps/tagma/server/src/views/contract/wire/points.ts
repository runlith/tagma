import { Schema } from 'effect';
import { HeldChordText, parseChord, writeChord } from '../../../platform/contract/wire/chord.js';
import type { PluginFace, PointHeld } from '../../../platform/contract/wire/contribution.js';
import { ToolEntry, TOOLS_FACE } from '../../../plugin-host/contract/wire/audience.js';

export const ViewId = Schema.String.check(Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u), Schema.isMaxLength(40)).annotate({
  description: 'The view, named within its plugin: lowercase letters, digits and inner hyphens.',
});

const OWN_FILE = /^(?!_modules\/)(?!\.{1,2}(?:\/|$))[^/\\\0]+(?:\/(?!\.{1,2}(?:\/|$))[^/\\\0]+)*$/u;

const ownFile = (extension: RegExp) =>
  Schema.String.check(
    Schema.isPattern(OWN_FILE),
    Schema.makeFilter((path: string) => extension.test(path) || `ends in ${extension.source.replace(/\\|\$/gu, '')}`),
    Schema.isMaxLength(200),
  );

export const ViewEntry = Schema.Struct({
  id: ViewId,
  entry: ownFile(/\.svelte$/u).annotate({
    description: 'The Svelte component of the view, by its path from the plugin’s root, as dist/ui/ ships it, e.g. ui/Table.svelte.',
  }),
  live: Schema.optional(Schema.Boolean).annotate({
    description:
      'true: a view in a tool result keeps running while scrolled away, within the feed’s budget. Absent: it unmounts out of sight.',
  }),
  media: Schema.optional(Schema.Literal(true)).annotate({
    description:
      'true: the view embeds a site with <Frame media>, which may ask the person for the camera and microphone. The build writes it.',
  }),
});
export type ViewEntry = typeof ViewEntry.Type;

const unique =
  <A>(key: (entry: A) => string, noun: string) =>
  (entries: readonly A[]) => {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(key(entry))) return `the ${noun} ${key(entry)} is listed twice`;
      seen.add(key(entry));
    }
    return true;
  };

export const ViewEntries = Schema.Array(ViewEntry).check(Schema.makeFilter(unique((entry: ViewEntry) => entry.id, 'view')));
export type ViewEntries = typeof ViewEntries.Type;

export const ResultEntry = Schema.Struct({
  tool: ToolEntry.fields.name.annotate({ description: 'A tool of the plugin’s process, named in contributes.tools for agents or own.' }),
  view: ViewId.annotate({ description: 'The view its call shows in the feed, one of contributes.views.' }),
});
export type ResultEntry = typeof ResultEntry.Type;

export const ResultEntries = Schema.Array(ResultEntry).check(Schema.makeFilter(unique((entry: ResultEntry) => entry.tool, 'tool')));
export type ResultEntries = typeof ResultEntries.Type;

export const SectionEntry = Schema.Struct({
  view: ViewId.annotate({ description: 'The view the section or pane shows, one of contributes.views.' }),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)).annotate({
    description: 'What the navigation, the palette and the pane header call it.',
  }),
  icon: Schema.optional(ownFile(/\.(?:svg|png|webp|gif|jpg)$/u)).annotate({
    description:
      'An image file by its path from the plugin’s root, as dist/ui/ ships it, e.g. ui/icon.svg. Absent: a neutral plugin glyph.',
  }),
});
export type SectionEntry = typeof SectionEntry.Type;

export const SectionEntries = Schema.Array(SectionEntry).check(Schema.makeFilter(unique((entry: SectionEntry) => entry.view, 'view')));
export type SectionEntries = typeof SectionEntries.Type;

export const LauncherEntry = Schema.Struct({
  view: ViewId.annotate({ description: 'The view it opens in a window, one of contributes.views. The plugin needs no process for it.' }),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)).annotate({
    description: 'The words of the palette action and the rail button that open the view.',
  }),
});
export type LauncherEntry = typeof LauncherEntry.Type;

export const LauncherEntries = Schema.Array(LauncherEntry).check(Schema.makeFilter(unique((entry: LauncherEntry) => entry.view, 'view')));
export type LauncherEntries = typeof LauncherEntries.Type;

const ActionEntry = Schema.Struct({
  id: ViewId.annotate({ description: 'The action, named within its plugin: lowercase letters, digits and inner hyphens.' }),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)).annotate({
    description: 'What the palette and the shortcuts screen call the action.',
  }),
  tool: ToolEntry.fields.name.annotate({
    description: 'The tool of the plugin’s process that runs the action, named in contributes.tools with audience tagma.',
  }),
});
type ActionEntry = typeof ActionEntry.Type;

export const ActionEntries = Schema.Array(ActionEntry).check(Schema.makeFilter(unique((entry: ActionEntry) => entry.id, 'action')));
export type ActionEntries = typeof ActionEntries.Type;

const CommandName = ViewId.annotate({
  description:
    'What the person types after / in a thread’s composer, named within its plugin: lowercase letters, digits and inner hyphens.',
});

const CommandDescription = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)).annotate({
  description: 'What the composer’s list of commands says it does.',
});

export const CommandEntry = Schema.Union([
  Schema.Struct({
    name: CommandName,
    description: CommandDescription,
    text: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The text the command puts into the draft.' }),
  }),
  Schema.Struct({
    name: CommandName,
    description: CommandDescription,
    action: ViewId.annotate({
      description:
        'An id of contributes.actions. The composer runs it with the thread and the words typed after the command, and its answer fills the draft.',
    }),
  }),
]);
export type CommandEntry = typeof CommandEntry.Type;

export const CommandEntries = Schema.Array(CommandEntry).check(Schema.makeFilter(unique((entry: CommandEntry) => entry.name, 'command')));
export type CommandEntries = typeof CommandEntries.Type;

const ShortcutEntry = Schema.Struct({
  keys: HeldChordText.annotate({ description: 'The chord this plugin proposes, like Mod+Alt+G.' }),
  action: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)).annotate({
    description:
      'What the chord runs: an id of contributes.actions, section:<view> for a section of contributes.surfaces, or pane:<view> for a pane of contributes.panes.',
  }),
  global: Schema.optional(Schema.Boolean).annotate({
    description:
      'true asks for the chord to work in every app. It is a request: the person allows it on the plugin’s card, and until then the chord works inside Tagma.',
  }),
});
type ShortcutEntry = typeof ShortcutEntry.Type;

export const ShortcutEntries = Schema.Array(ShortcutEntry);
export type ShortcutEntries = typeof ShortcutEntries.Type;

export const VIEWS_FACE: PluginFace<ViewEntries> = {
  name: 'views',
  title: 'Pages inside Tagma',
  schema: ViewEntries,
  uses: (views) => (views.some((view) => view.media === true) ? 'Uses camera and microphone' : null),
};

export const undeclaredViews = (sibling: PointHeld['sibling'], named: readonly string[]): string | null => {
  const declared = new Set((sibling(VIEWS_FACE) ?? []).map((view) => view.id));
  const unseen = [...new Set(named.filter((view) => !declared.has(view)))];
  return unseen.length === 0 ? null : `names the view ${unseen.join(', ')}, which contributes.views does not declare`;
};

const viewsNamed = (entries: readonly { readonly view: string }[], { sibling }: PointHeld): string | null =>
  undeclaredViews(
    sibling,
    entries.map((entry) => entry.view),
  );

export const RESULTS_FACE: PluginFace<ResultEntries> = {
  name: 'results',
  title: 'Pages that show what a tool did',
  schema: ResultEntries,
  refuses: (results, held) => {
    const unseen = viewsNamed(results, held);
    if (unseen !== null) return unseen;
    const called = new Map((held.sibling(TOOLS_FACE) ?? []).map((tool) => [tool.name, tool.audience]));
    const silent = results.filter((result) => {
      const audience = called.get(result.tool);
      return audience !== 'agents' && audience !== 'own';
    });
    return silent.length === 0
      ? null
      : `no agent calls ${silent.map((result) => result.tool).join(', ')}; name it in contributes.tools for agents or own`;
  },
};

export const SURFACES_FACE: PluginFace<SectionEntries> = {
  name: 'surfaces',
  title: 'Sections in Tagma’s sidebar',
  schema: SectionEntries,
  refuses: viewsNamed,
};

export const PANES_FACE: PluginFace<SectionEntries> = {
  name: 'panes',
  title: 'Panels beside a thread',
  schema: SectionEntries,
  refuses: viewsNamed,
};

export const LAUNCHERS_FACE: PluginFace<LauncherEntries> = {
  name: 'launchers',
  title: 'Windows you open from the palette',
  schema: LauncherEntries,
  refuses: viewsNamed,
};

export const ACTIONS_FACE: PluginFace<ActionEntries> = {
  name: 'actions',
  title: 'Actions you run from the palette or a shortcut',
  schema: ActionEntries,
  calls: (entries) => entries.map((entry) => entry.tool),
};

export const COMMANDS_FACE: PluginFace<CommandEntries> = {
  name: 'commands',
  title: 'Commands you type in a thread',
  schema: CommandEntries,
  refuses: (commands, { sibling }) => {
    const declared = new Set((sibling(ACTIONS_FACE) ?? []).map((entry) => entry.id));
    const lost = [
      ...new Set(commands.flatMap((command) => ('action' in command && !declared.has(command.action) ? [command.action] : []))),
    ];
    return lost.length === 0 ? null : `names the action ${lost.join(', ')}, which contributes.actions does not declare`;
  },
};

const SECTION = 'section:';
const PANE = 'pane:';

const unnamed = (shortcut: ShortcutEntry, { sibling }: PointHeld): boolean => {
  if (shortcut.action.startsWith(SECTION))
    return !(sibling(SURFACES_FACE) ?? []).some((entry) => entry.view === shortcut.action.slice(SECTION.length));
  if (shortcut.action.startsWith(PANE))
    return !(sibling(PANES_FACE) ?? []).some((entry) => entry.view === shortcut.action.slice(PANE.length));
  return !(sibling(ACTIONS_FACE) ?? []).some((entry) => entry.id === shortcut.action);
};

export const SHORTCUTS_FACE: PluginFace<ShortcutEntries> = {
  name: 'shortcuts',
  title: 'Shortcuts',
  schema: ShortcutEntries,
  refuses: (shortcuts, held) => {
    const lost = [...new Set(shortcuts.filter((shortcut) => unnamed(shortcut, held)).map((shortcut) => shortcut.action))];
    if (lost.length > 0)
      return `names ${lost.join(', ')}, which is no action of contributes.actions, no section:<view> of contributes.surfaces and no pane:<view> of contributes.panes`;
    const seen = new Set<string>();
    for (const { keys } of shortcuts) {
      const chord = writeChord(parseChord(keys)!);
      if (seen.has(chord)) return `the chord ${chord} is listed twice`;
      seen.add(chord);
    }
    return null;
  },
};
