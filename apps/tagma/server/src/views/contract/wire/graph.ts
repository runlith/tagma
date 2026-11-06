import { Schema } from 'effect';

export const VIEW_GRAPH = 'dist/ui';

export const GRAPH_FILE = 'graph.json';

const GraphPath = Schema.String.check(
  Schema.isPattern(/^(?!\.{1,2}(?:\/|$))[^/\\\0]+(?:\/(?!\.{1,2}(?:\/|$))[^/\\\0]+)*$/u),
  Schema.isMaxLength(400),
).annotate({ description: 'A file of the view graph, relative to dist/ui/.' });

const GraphFile = Schema.Struct({
  imports: Schema.Record(Schema.String, Schema.Union([GraphPath, Schema.Literal('host')])).annotate({
    description:
      'Every import specifier the file’s compiled code writes, with the graph file it resolved to, or host for a module the window serves.',
  }),
  dependency: Schema.optional(Schema.Literal(true)).annotate({
    description: 'true: the file belongs to a package the plugin depends on, so Svelte decides its mode instead of runes.',
  }),
});

export const ViewGraph = Schema.Struct({
  files: Schema.Record(GraphPath, GraphFile),
  candidates: Schema.Array(Schema.String).annotate({
    description: 'The Tailwind class candidates of every shipped file, as Tailwind’s own scanner reads them.',
  }),
});
export type ViewGraph = typeof ViewGraph.Type;
