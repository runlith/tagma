import { McpAppCsp } from '@runlith/mcp/apps';
import { Schema } from 'effect';
import { ToolEntry } from '../../../tagma-apps/contract/wire/audience.js';

export const ViewId = Schema.String.check(Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u), Schema.isMaxLength(40)).annotate({
  description: 'The view, named within its app: lowercase letters, digits and inner hyphens.',
});

export const ViewEntry = Schema.Struct({
  id: ViewId,
  entry: Schema.String.check(
    Schema.isPattern(/^ui\/(?:(?!\.\.?\/)[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.html$/u),
    Schema.isMaxLength(200),
  ).annotate({ description: 'The HTML page of the view inside the app’s ui/ directory, e.g. ui/table.html.' }),
  live: Schema.optional(Schema.Boolean).annotate({
    description:
      'true: a view in a tool result keeps running while scrolled away, within the feed’s budget. Absent: it unmounts out of sight.',
  }),
  csp: Schema.optional(McpAppCsp).annotate({
    description:
      'The outside origins the page may reach, as an MCP Apps CSP declaration: frameDomains for embedded players, resourceDomains for images, media, scripts and styles, connectDomains for fetch and sockets. Absent: the page reaches only its own app. An entry that names this machine, a bare address or more than one source is dropped.',
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
  tool: ToolEntry.fields.name.annotate({ description: 'A tool of the app’s process, named in contributes.tools for agents or own.' }),
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
  icon: Schema.optional(
    Schema.String.check(
      Schema.isPattern(/^ui\/(?:(?!\.\.?\/)[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:svg|png|webp|gif|jpg)$/u),
      Schema.isMaxLength(200),
    ),
  ).annotate({
    description:
      'An image file inside the app’s ui/ directory, served from the app’s own origin like its views. Absent: a neutral app glyph.',
  }),
});
export type SectionEntry = typeof SectionEntry.Type;

export const SectionEntries = Schema.Array(SectionEntry).check(Schema.makeFilter(unique((entry: SectionEntry) => entry.view, 'view')));
export type SectionEntries = typeof SectionEntries.Type;

export const LauncherEntry = Schema.Struct({
  view: ViewId.annotate({ description: 'The view it opens in a window, one of contributes.views. The app needs no process for it.' }),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)).annotate({
    description: 'The words of the palette action and the rail button that open the view.',
  }),
});
export type LauncherEntry = typeof LauncherEntry.Type;

export const LauncherEntries = Schema.Array(LauncherEntry).check(Schema.makeFilter(unique((entry: LauncherEntry) => entry.view, 'view')));
export type LauncherEntries = typeof LauncherEntries.Type;
