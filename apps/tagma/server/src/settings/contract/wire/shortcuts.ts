import { Schema } from 'effect';
import { HeldChordText } from '../../../platform/contract/wire/chord.js';
import { settingKey } from '../../../platform/contract/wire/setting.js';

export const SHORTCUTS_SETTING_SECTIONS = [
  {
    id: 'shortcuts',
    order: 30,
    title: 'Shortcuts',
    description: 'The keys that run Tagma’s and your plugins’ actions, in the window and, on the desktop, in every app.',
  },
] as const;

const ShortcutChoice = Schema.Struct({
  keys: HeldChordText,
  global: Schema.optional(Schema.Boolean).annotate({ description: 'true: the chord works in every app on the desktop while Tagma runs.' }),
});
export const ShortcutBindings = Schema.Record(Schema.String, Schema.Array(ShortcutChoice));
export type ShortcutBindings = typeof ShortcutBindings.Type;

export const shortcutBindings = settingKey({
  id: 'shortcuts.bindings',
  order: 10,
  title: 'Your shortcuts',
  description:
    'The chords you chose, by action id. An action listed with no chords has no keys; an action not listed keeps the chords Tagma or its plugin gives it. Mod is ⌘ on macOS and Ctrl elsewhere.',
  schema: ShortcutBindings,
  fallback: {},
  scopes: ['user'],
  merge: 'replace',
});
