import { Schema } from 'effect';
import { extensionsOf, type Languages } from '../../../core/languages';
import { baseOrRoot, defaulted, describeFiles, filesOrAll } from '../../../core/params';
import type { Shown } from '../../../core/rule';

const languages: Languages = ['js'];

const files = filesOrAll(extensionsOf(languages));

const params = Schema.Struct({
  base: baseOrRoot,
  allows: defaulted(
    Schema.Array(Schema.NonEmptyString).annotate({
      description:
        "Glob patterns matched against the path relative to `base`; a matching file may forward bindings, as a published library's entry does, and is not read.",
    }),
    [],
  ),
  files,
});

type Params = typeof params.Type;

const describe = (value: Params): string =>
  [
    `Re-exports ${describeFiles(value.base, value.files)}: no file forwards a binding out of its module — \`export * from\`, \`export * as … from\`, \`export { … } from\`, type-only included, or an export of a binding it imported.`,
    ...(value.allows.length === 0 ? [] : [`Allowed to forward: ${value.allows.map((glob) => `\`${glob}\``).join(', ')}.`]),
  ].join('\n');

const shows = (value: Params): Shown => ({
  figures: value.allows.length === 0 ? [] : [{ kind: 'lists', lists: [{ label: 'May forward', items: value.allows }] }],
});

export const reexports = {
  id: 'reexports',
  params,
  summary: 'No selected file forwards a binding out of its module.',
  concern: 'code',
  lists: [{ at: 'allows', item: Schema.NonEmptyString, key: Schema.NonEmptyString, identity: [] }],
  describe,
  shows,
  languages,
  reach: 'local',
  fileLocal: true,
  unit: 'forwarded specifier per file',
  limitations: [
    "A forward is a re-export statement — `export * from`, `export * as … from`, `export { … } from`, type-only and empty braces included, and one inside an ambient `declare module` — or `export = require()`, or a module-level `export { a }`, `export default a` or `export = a` naming a binding an import, an `import a = require()` or a module-level `const a = require()` brought in. Anything else built from an import — `export default a.b`, `export default (a)`, `export const b = a` — is the module's own value, and a CommonJS `module.exports` is not read. In a file embedding several scripts only the module script forwards; what an instance script exports belongs to the instance.",
    'A forwarded binding is placed at the line of the import that brought it in, where its specifier is written, not at the export naming it.',
    'The fingerprint names the file, so renaming or moving a file that carries debt is a new violation, refused at gate until `enforce_rule` absorbs it.',
    'A selected file whose text is not UTF-8 or does not parse fails the whole inspection, never reads as a file forwarding nothing; `files.exclude` naming it is the way past.',
  ],
  unblock: [
    'Import each forwarded binding from the file that defines it wherever it is used, then delete the forwarding statement — and the file, when nothing of its own is left.',
  ],
} as const;
