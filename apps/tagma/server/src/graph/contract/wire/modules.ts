import { Schema } from 'effect';
import { nameRef } from './fields.js';

const segment = String.raw`(?!\.{1,2}(?:/|$))[^/\\]+`;

export const ROOT_FLOOR = '.';

export const insidePath = Schema.String.check(Schema.isPattern(new RegExp(`^${segment}(?:/${segment})*/?$`, 'u'))).annotate({
  description: 'A directory (ending in `/`) or a file, relative to the module root.',
});

export const moduleEntriesSchema = Schema.Array(
  Schema.Struct({
    at: Schema.Union([Schema.Literal(ROOT_FLOOR), insidePath]),
    for: Schema.optional(Schema.NonEmptyArray(nameRef).annotate({ description: 'The module cards this entry is open to alone.' })),
    role: Schema.optional(Schema.Literals(['port', 'testing'])),
  }),
).annotate({ description: 'What another module may import of this one, each relative to the module root.' });
export type ModuleEntries = typeof moduleEntriesSchema.Type;

export const moduleOrderSchema = Schema.Array(Schema.NonEmptyArray(Schema.Union([Schema.Literal(ROOT_FLOOR), insidePath]))).annotate({
  description: 'The floors inside the module, bottom first, each path relative to the module root; `.` is the root itself.',
});
export type ModuleOrder = typeof moduleOrderSchema.Type;

export type Unreadable = { readonly id?: string; readonly entries?: string; readonly order?: string };

export type ModuleCard = {
  readonly block: number;
  readonly name: string;
  readonly title: string;
  readonly parent: number | null;
  readonly placedUnder: number | null;
  readonly id: string | undefined;
  readonly roots: readonly string[];
  readonly cuts: readonly string[];
  readonly entries: ModuleEntries | undefined;
  readonly order: ModuleOrder | undefined;
  readonly imports: readonly number[];
  readonly importsTests: readonly number[];
  readonly unreadable: Unreadable | undefined;
};

export type CardRef = number;

export type ModuleDoor = { readonly at: string; readonly for?: readonly CardRef[]; readonly role?: 'port' | 'testing' };

export type ModuleWrite = {
  readonly id: string;
  readonly block?: number;
  readonly handle?: CardRef;
  readonly title?: string;
  readonly body?: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly parent?: number;
  readonly remove?: true;
  readonly root?: string;
  readonly cuts?: readonly string[];
  readonly entries?: readonly ModuleDoor[] | null;
  readonly order?: ModuleOrder | null;
  readonly imports?: readonly CardRef[];
  readonly importsTests?: readonly CardRef[];
};
