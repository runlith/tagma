// @vitest-environment jsdom
import { Host } from '@runlith/layer/Host';
import type { Terminal } from '@xterm/xterm';
import { afterEach, expect, test } from 'vitest';
import { kittyKeyboardFlags, ligaturesEnabled, terminalFontFamily, terminalMinimumContrastRatio } from './engineOptions.js';
import { openEngine } from './terminalEngine.js';
import type { Engine } from './terminalEngine.js';

const opened: Engine[] = [];

afterEach(() => {
  for (const engine of opened.splice(0)) engine.dispose();
  document.body.replaceChildren();
});

function open(options: Parameters<typeof openEngine>[1] = {}, platform = new Host('desktop', 'macos')): Engine {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const engine = openEngine(host, options, platform);
  opened.push(engine);
  return engine;
}

test('the option table is every figure the decision names, with no engine default left standing', () => {
  const { terminal } = open();

  expect(terminal.options.allowProposedApi).toBe(true);
  expect(terminal.options.allowTransparency).toBe(false);
  expect(terminal.options.cursorBlink).toBe(true);
  expect(terminal.options.cursorStyle).toBe('block');
  expect(terminal.options.cursorInactiveStyle).toBe('outline');
  expect(terminal.options.drawBoldTextInBrightColors).toBe(true);
  expect(terminal.options.fontSize).toBe(14);
  expect(terminal.options.fontWeight).toBe(500);
  expect(terminal.options.fontWeightBold).toBe(700);
  expect(terminal.options.lineHeight).toBe(1);
  expect(terminal.options.scrollback).toBe(5000);
  expect(terminal.options.scrollSensitivity).toBe(1.15);
  expect(terminal.options.fastScrollSensitivity).toBe(5);
  expect(terminal.options.scrollbar?.width).toBe(7);
  expect(terminal.options.vtExtensions?.kittyKeyboard).toBe(true);
  expect(terminal.options.minimumContrastRatio).toBe(3);
  expect(terminal.options.macOptionClickForcesSelection).toBe(true);
  expect(terminal.options.macOptionIsMeta).toBe(false);
});

test('read-only input hides the cursor through focus and terminal resets without losing the program’s cursor mode', async () => {
  const { terminal } = open();
  const write = (bytes: string) => new Promise<void>((done) => terminal.write(bytes, done));

  terminal.options.disableStdin = true;
  terminal.focus();
  await write('\x1bc\x1b[?25h');
  expect(terminal.modes.showCursor).toBe(false);
  terminal.blur();
  expect(terminal.modes.showCursor).toBe(false);

  terminal.options.disableStdin = false;
  expect(terminal.modes.showCursor).toBe(true);
  await write('\x1b[?25l');
  terminal.options.disableStdin = true;
  terminal.options.disableStdin = false;
  expect(terminal.modes.showCursor).toBe(false);
  await write('\x1b[?25h');
  expect(terminal.modes.showCursor).toBe(true);
});

test('the kitty keyboard protocol can be switched off for an engine over a host that does not advertise it', () => {
  expect(open({ kittyKeyboard: false }).terminal.options.vtExtensions?.kittyKeyboard).toBe(false);
});

test('the kitty flags are read off the engine: none until a program pushes them, then what it pushed', () => {
  const { terminal } = open({});
  expect(kittyKeyboardFlags(terminal)).toBe(0);
  terminal.write('\x1b[>1u');
  return new Promise<void>((resolve) => {
    terminal.write('', () => {
      expect(kittyKeyboardFlags(terminal)).toBe(1);
      terminal.write('\x1b[<u', () => {
        expect(kittyKeyboardFlags(terminal)).toBe(0);
        resolve();
      });
    });
  });
});

test('a bar cursor keeps its own inactive style, because an outline would add strokes to it', () => {
  expect(open({ cursorStyle: 'bar' }).terminal.options.cursorInactiveStyle).toBe('bar');
});

test('the chosen family stands in front of the fallback chain, and the chain is complete', () => {
  expect(terminalFontFamily('Fira Code')).toBe(
    '"Fira Code", "SF Mono", "Menlo", "Monaco", "Cascadia Mono", "Consolas", "DejaVu Sans Mono", ' +
      '"Liberation Mono", "Symbols Nerd Font Mono", "MesloLGS Nerd Font", "JetBrainsMono Nerd Font", ' +
      '"Hack Nerd Font", monospace',
  );
  expect(terminalFontFamily(undefined).startsWith('"SF Mono"')).toBe(true);
});

test('the contrast floor follows the background as it stands over the theme’s ground, not the app mode', () => {
  expect(terminalMinimumContrastRatio('#ffffff', '#0a0a0a')).toBe(4.5);
  expect(terminalMinimumContrastRatio('#000000', '#ffffff')).toBe(3);
  expect(terminalMinimumContrastRatio('rgba(0, 0, 0, 0.05)', '#ffffff')).toBe(4.5);
  expect(terminalMinimumContrastRatio('rgba(0, 0, 0, 0.05)', '#2e3440')).toBe(3);
  expect(terminalMinimumContrastRatio('rgb(24 24 27 / 90%)', '#ffffff')).toBe(3);
});

test('a family that ships ligatures gets them without a setting, and an explicit setting wins', () => {
  expect(ligaturesEnabled('auto', 'JetBrainsMono Nerd Font')).toBe(true);
  expect(ligaturesEnabled('auto', 'SF Mono')).toBe(false);
  expect(ligaturesEnabled('off', 'Fira Code')).toBe(false);
  expect(ligaturesEnabled('on', 'SF Mono')).toBe(true);
});

test('a pane on a family that ships ligatures opens with the ligatures addon on it', () => {
  expect(open({ fontFamily: 'Fira Code' }).ligatures).not.toBeNull();
  expect(open({ fontFamily: 'SF Mono' }).ligatures).toBeNull();
});

test('ligatures turn on and off in place, and a call that matches the state changes nothing', () => {
  const engine = open({ fontFamily: 'SF Mono' });
  const takenSince = (mark: number): number => engine.terminal.registerCharacterJoiner(() => []) - mark - 1;

  expect(engine.ligatures).toBeNull();

  let mark = engine.terminal.registerCharacterJoiner(() => []);
  engine.setLigatures(true);
  const attached = engine.ligatures;
  expect(attached).not.toBeNull();
  expect(takenSince(mark)).toBe(1);

  mark = engine.terminal.registerCharacterJoiner(() => []);
  engine.setLigatures(true);
  expect(engine.ligatures).toBe(attached);
  expect(takenSince(mark)).toBe(0);

  engine.setLigatures(false);
  expect(engine.ligatures).toBeNull();
  mark = engine.terminal.registerCharacterJoiner(() => []);
  engine.setLigatures(false);
  expect(takenSince(mark)).toBe(0);

  mark = engine.terminal.registerCharacterJoiner(() => []);
  engine.setLigatures(true);
  expect(engine.ligatures).not.toBe(attached);
  expect(takenSince(mark)).toBe(1);
});

test('Unicode 11 is live before the engine can be written to', () => {
  expect(open().terminal.unicode.activeVersion).toBe('11');
});

test('the renderer hook is handed a terminal whose addon set already stands', () => {
  let versionAtAttach: string | null = null;
  let attached = 0;
  const engine = open({
    attachWebgl: (terminal: Terminal) => {
      attached += 1;
      versionAtAttach = terminal.unicode.activeVersion;
    },
  });

  expect(attached).toBe(1);
  expect(versionAtAttach).toBe('11');
  expect(engine.terminal.element).not.toBeNull();
});

test('disposal releases the guards while the terminal still stands, and takes it down after', () => {
  const engine = open();
  let attachedAtRelease: boolean | null = null;
  engine.onDispose(() => {
    attachedAtRelease = engine.terminal.element?.isConnected ?? false;
  });

  engine.dispose();

  expect(attachedAtRelease).toBe(true);
  expect(engine.terminal.element?.isConnected ?? false).toBe(false);
});
