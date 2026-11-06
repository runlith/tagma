import { Schema } from 'effect';

export const ViewModule = Schema.Union([
  Schema.Struct({ state: Schema.Literal('preparing') }),
  Schema.Struct({
    state: Schema.Literal('ready'),
    address: Schema.String.annotate({ description: 'The compiled module the window imports, on the door the feed came through.' }),
  }),
  Schema.Struct({
    state: Schema.Literal('failed'),
    message: Schema.String.annotate({ description: 'The compiler’s message.' }),
    file: Schema.NullOr(Schema.String).annotate({ description: 'The file of the view graph it names, when it names one.' }),
  }),
]).pipe(Schema.toTaggedUnion('state'));
export type ViewModule = typeof ViewModule.Type;

export const MODULES_PATH = '/api/views/modules';

export const SHEET_PATH = '/api/views/sheet';

export const moduleAddress = (plugin: string, key: string, file: string): string => `${MODULES_PATH}/${plugin}/${key}/${file}`;
