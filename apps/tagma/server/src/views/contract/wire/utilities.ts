import { Schema } from 'effect';

export const UTILITIES_FILE = '_app/host/utilities.json';

export const CANDIDATES_PATH = '/api/views/candidates';

export const Stylesheet = Schema.Struct({
  path: Schema.String,
  base: Schema.String,
  content: Schema.String,
});
export type Stylesheet = typeof Stylesheet.Type;

export const WindowUtilities = Schema.Struct({
  entry: Schema.String.annotate({ description: 'The window’s stylesheet, as utilitiesSource names it from base `.`.' }),
  candidates: Schema.Array(Schema.String).annotate({ description: 'Every class candidate the window’s own Tailwind scan found.' }),
  stylesheets: Schema.Record(Schema.String, Stylesheet).annotate({
    description: 'Every stylesheet utilitiesSource loads, by stylesheetKey of the id and base it was asked with.',
  }),
});
export type WindowUtilities = typeof WindowUtilities.Type;

export const Candidates = Schema.Struct({ candidates: Schema.Array(Schema.String) });
export type Candidates = typeof Candidates.Type;

export const stylesheetKey = (id: string, base: string): string => `${base}\u0000${id}`;

export const utilitiesSource = (entry: string): string =>
  `@reference ${JSON.stringify(entry)};\n@import 'tailwindcss/utilities.css' layer(utilities);\n`;
