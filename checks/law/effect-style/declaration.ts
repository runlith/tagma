import { Schema } from 'effect';
import { extensionsOf } from '../languages';
import { base, distinct, entry, filesOf } from '../params';

export const FORMS = [
  'self-alias',
  'self-binding',
  'service-class',
  'service-instance',
  'gen-wrapper',
  'pipe-after-fn',
  'throw-in-effect',
  'sync-decode-in-effect',
  'clock-bypass',
  'scope-run-sync',
  'schema-tagged-error',
  'native-tagged-error',
  'test-runner',
] as const;

export type Form = (typeof FORMS)[number];

export const TOP = '(top)';

const params = Schema.Struct({
  base,
  region: Schema.NonEmptyArray(entry).check(
    Schema.makeFilter((entries) =>
      !distinct(entries)
        ? 'a region entry is named once'
        : entries.some((one) => !one.endsWith('/'))
          ? 'a region entry is a directory prefix'
          : undefined,
    ),
  ),
  files: filesOf(extensionsOf(['js'])),
  forms: Schema.NonEmptyArray(Schema.Literals(FORMS))
    .check(Schema.makeFilter((forms) => (new Set(forms).size === forms.length ? undefined : 'a form is named once')))
    .annotate({ description: 'The syntactic Effect forms this rule judges.' }),
});

export type EffectStyleParams = typeof params.Type;

export const effectStyle = { id: 'effect-style', params } as const;
