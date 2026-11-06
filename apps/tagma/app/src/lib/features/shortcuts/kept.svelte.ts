import type { DesktopKeys } from '@tagma/desktop/bridge';
import { type HostChord, hostChordOf } from '@tagma/server/platform/contract/wire/chord';
import type { Host } from '@runlith/layer/Host';

const parsed = (texts: readonly string[], mac: boolean): readonly HostChord[] =>
  texts.flatMap((text) => {
    const chord = hostChordOf(text, mac);
    return chord === null ? [] : [chord];
  });

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

const BROWSER_BOTH = [
  'Mod+T',
  'Mod+W',
  'Mod+N',
  'Mod+R',
  'Mod+Shift+N',
  'Mod+Shift+T',
  'Mod+Shift+W',
  'Ctrl+Tab',
  'Ctrl+Shift+Tab',
  'Ctrl+PageDown',
  'Ctrl+PageUp',
  ...DIGITS.map((digit) => `Mod+${digit}`),
];

const BROWSER_MAC = ['Cmd+Q', 'Cmd+H', 'Cmd+M', 'Cmd+Alt+H'];

const BROWSER_OTHER = ['Ctrl+Shift+Q', ...DIGITS.map((digit) => `Alt+${digit}`)];

export const browserKept = (host: Host): { readonly kept: readonly HostChord[] } => ({
  kept: parsed([...BROWSER_BOTH, ...(host.apple ? BROWSER_MAC : BROWSER_OTHER)], host.apple),
});

export class DesktopKept {
  kept = $state.raw<readonly HostChord[]>([]);

  constructor(desktop: DesktopKeys | undefined, mac: boolean) {
    void desktop?.kept().then((texts) => (this.kept = parsed(texts, mac)));
  }
}
