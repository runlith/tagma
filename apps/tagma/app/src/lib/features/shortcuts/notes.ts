import { chordId } from '@tagma/server/platform/contract/wire/chord';
import type { Host } from '@runlith/layer/Host';
import type { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import type { Row, Shortcuts } from './Shortcuts.svelte.js';

type Note = {
  readonly key: string;
  readonly kind: 'displaced' | 'kept' | 'refused' | 'accessibility' | 'offered' | 'focused';
  readonly chord: string | null;
  readonly text: string;
  readonly act: { readonly label: string; readonly run: () => void } | null;
};

export function notesOf(row: Row, shortcuts: Shortcuts, keymap: Keymap, host: Host, allow: (() => void) | null = null): readonly Note[] {
  const notes: Note[] = [];
  for (const displaced of row.displaced) {
    const chord = keymap.spellChord(displaced.chord);
    const key = `displaced ${chordId(displaced.chord)}`;
    if (displaced.by.kind === 'shell')
      notes.push({
        key,
        kind: 'kept',
        chord,
        text: host.isDesktop ? 'Tagma keeps this chord' : 'Your browser keeps this chord',
        act: null,
      });
    else notes.push({ key, kind: 'displaced', chord, text: `taken by ${shortcuts.titleOf(displaced.by.action)}`, act: null });
  }
  for (const binding of row.bound) {
    const chord = keymap.spellChord(binding.chord);
    const key = chordId(binding.chord);
    if (binding.offered && host.isDesktop)
      notes.push({
        key: `offered ${key}`,
        kind: 'offered',
        chord,
        text: 'Offered in every app',
        act: { label: 'Work in every app', run: () => void shortcuts.everywhere(row.keyed.id, binding.chord, true) },
      });
    if (!binding.global) continue;
    if (!host.isDesktop) {
      notes.push({ key: `focused ${key}`, kind: 'focused', chord: null, text: 'Works only while this tab is focused', act: null });
      continue;
    }
    const answer = keymap.answerOf(binding.chord);
    if (answer?.grant === 'taken')
      notes.push({ key: `refused ${key}`, kind: 'refused', chord, text: 'Another app holds this chord', act: null });
    else if (answer?.grant === 'needs-accessibility')
      notes.push({
        key: `accessibility ${key}`,
        kind: 'accessibility',
        chord: null,
        text: 'Tagma needs Accessibility to hear this key in other apps.',
        act: allow === null ? null : { label: 'Open System Settings', run: allow },
      });
    else if (answer?.grant === 'unavailable')
      notes.push({
        key: `refused ${key}`,
        kind: 'refused',
        chord,
        text: answer.reason ?? 'This chord cannot work in every app here',
        act: null,
      });
  }
  return notes;
}
