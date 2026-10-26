import { describe, expect, test } from 'vitest';
import { Host } from '@runlith/layer/Host';
import {
  TerminalKeymap,
  detectLayoutCategory,
  effectiveMacOptionAsAlt,
  type KeymapEvent,
  type Resolution,
  type ResolveContext,
} from './Keymap.js';

const mac = new TerminalKeymap(new Host('desktop', 'macos'));
const linux = new TerminalKeymap(new Host('desktop', 'linux'));
const win = new TerminalKeymap(new Host('desktop', 'windows'));
const macFirst = new TerminalKeymap(new Host('desktop', 'macos'), () => 'terminal-first');
const linuxFirst = new TerminalKeymap(new Host('desktop', 'linux'), () => 'terminal-first');
const tabMac = new TerminalKeymap(new Host('tab', 'macos'));
const tabLinux = new TerminalKeymap(new Host('tab', 'linux'));
const tabWin = new TerminalKeymap(new Host('tab', 'windows'));

const ESC = 0x1b;

function escTail(tail: string): number[] {
  return [ESC, ...tail.split('').map((c) => c.charCodeAt(0))];
}

function summarize(resolution: Resolution): string | number[] {
  if (resolution.kind === 'engine') return 'engine';
  if (resolution.kind === 'interrupt') return 'interrupt';
  if (resolution.kind === 'act') {
    return resolution.act._tag === 'select-index' ? `select-index:${resolution.act.index}` : resolution.act._tag;
  }
  return [...resolution.bytes];
}

type Case = readonly [string, TerminalKeymap, KeymapEvent, ResolveContext | undefined, string | number[]];

const CASES: readonly Case[] = [
  ['darwin copy', mac, { key: 'c', code: 'KeyC', metaKey: true }, undefined, 'copy'],
  ['darwin select-all', mac, { key: 'a', code: 'KeyA', metaKey: true }, undefined, 'select-all'],
  ['darwin paste', mac, { key: 'v', code: 'KeyV', metaKey: true }, undefined, 'paste'],
  ['darwin search', mac, { key: 'f', code: 'KeyF', metaKey: true }, undefined, 'search'],
  ['darwin clear', mac, { key: 'k', code: 'KeyK', metaKey: true }, undefined, 'clear'],
  ['darwin focus-next', mac, { key: ']', code: 'BracketRight', metaKey: true }, undefined, 'focus-next'],
  ['darwin focus-previous', mac, { key: '[', code: 'BracketLeft', metaKey: true }, undefined, 'focus-previous'],
  ['darwin expand', mac, { key: 'Enter', code: 'Enter', metaKey: true, shiftKey: true }, undefined, 'expand-pane'],
  ['darwin close', mac, { key: 'w', code: 'KeyW', metaKey: true }, undefined, 'close-pane'],
  ['darwin split-right', mac, { key: 'd', code: 'KeyD', metaKey: true }, undefined, 'split-right'],
  ['darwin split-down', mac, { key: 'd', code: 'KeyD', metaKey: true, shiftKey: true }, undefined, 'split-down'],
  ['darwin new-tab', mac, { key: 't', code: 'KeyT', metaKey: true }, undefined, 'new-tab'],
  ['darwin reopen', mac, { key: 't', code: 'KeyT', metaKey: true, shiftKey: true }, undefined, 'reopen-tab'],
  ['darwin rename', mac, { key: 'r', code: 'KeyR', metaKey: true }, undefined, 'rename-tab'],
  ['darwin next-tab', mac, { key: 'PageDown', code: 'PageDown', ctrlKey: true }, undefined, 'next-tab'],
  ['darwin previous-tab', mac, { key: 'PageUp', code: 'PageUp', ctrlKey: true }, undefined, 'previous-tab'],
  ['darwin recent', mac, { key: 'Tab', code: 'Tab', ctrlKey: true }, undefined, 'previous-recent-tab'],
  ['darwin index-1', mac, { key: '1', code: 'Digit1', ctrlKey: true }, undefined, 'select-index:0'],
  ['darwin index-9', mac, { key: '9', code: 'Digit9', ctrlKey: true }, undefined, 'select-index:8'],
  ['darwin close-all-tabs', mac, { key: 'w', code: 'KeyW', metaKey: true, altKey: true }, undefined, 'close-all-tabs'],
  ['darwin close-all-tabs composed', mac, { key: '∑', code: 'KeyW', metaKey: true, altKey: true }, undefined, 'close-all-tabs'],
  ['darwin next-tab cycler', mac, { key: ']', code: 'BracketRight', metaKey: true, altKey: true }, undefined, 'next-tab'],
  ['darwin previous-tab cycler', mac, { key: '[', code: 'BracketLeft', metaKey: true, altKey: true }, undefined, 'previous-tab'],
  ['darwin zoom-in', mac, { key: '=', code: 'Equal', metaKey: true }, undefined, 'zoom-in'],
  ['darwin zoom-in plus', mac, { key: '+', code: 'Equal', metaKey: true, shiftKey: true }, undefined, 'zoom-in'],
  ['darwin zoom-out', mac, { key: '-', code: 'Minus', metaKey: true }, undefined, 'zoom-out'],
  ['darwin zoom-reset', mac, { key: '0', code: 'Digit0', metaKey: true }, undefined, 'zoom-reset'],
  ['darwin toggle', mac, { key: 'j', code: 'KeyJ', metaKey: true }, undefined, 'toggle-terminals'],
  ['darwin toggle in terminal', mac, { key: 'j', code: 'KeyJ', metaKey: true }, { inTerminal: true }, 'toggle-terminals'],
  ['linux copy-shift', linux, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true }, undefined, 'copy'],
  ['linux copy-selection', linux, { key: 'c', code: 'KeyC', ctrlKey: true }, { hasSelection: true }, 'copy'],
  ['linux select-all', linux, { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true }, undefined, 'select-all'],
  ['linux paste', linux, { key: 'v', code: 'KeyV', ctrlKey: true }, undefined, 'paste'],
  ['linux paste-shift', linux, { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true }, undefined, 'paste'],
  ['linux paste-insert', linux, { key: 'Insert', code: 'Insert', shiftKey: true }, undefined, 'paste'],
  ['linux search', linux, { key: 'f', code: 'KeyF', ctrlKey: true }, undefined, 'search'],
  ['linux clear', linux, { key: 'k', code: 'KeyK', ctrlKey: true }, undefined, 'clear'],
  ['linux focus-next', linux, { key: ']', code: 'BracketRight', ctrlKey: true }, undefined, 'focus-next'],
  ['linux focus-previous', linux, { key: '[', code: 'BracketLeft', ctrlKey: true }, undefined, 'focus-previous'],
  ['linux expand', linux, { key: 'Enter', code: 'Enter', ctrlKey: true, shiftKey: true }, undefined, 'expand-pane'],
  ['linux close', linux, { key: 'w', code: 'KeyW', ctrlKey: true }, undefined, 'close-pane'],
  ['linux split-right', linux, { key: 'd', code: 'KeyD', ctrlKey: true, shiftKey: true }, undefined, 'split-right'],
  ['linux split-down', linux, { key: 'd', code: 'KeyD', altKey: true, shiftKey: true }, undefined, 'split-down'],
  ['linux new-tab', linux, { key: 't', code: 'KeyT', ctrlKey: true }, undefined, 'new-tab'],
  ['linux reopen', linux, { key: 't', code: 'KeyT', ctrlKey: true, shiftKey: true }, undefined, 'reopen-tab'],
  ['linux next-tab', linux, { key: 'PageDown', code: 'PageDown', ctrlKey: true }, undefined, 'next-tab'],
  ['linux previous-tab', linux, { key: 'PageUp', code: 'PageUp', ctrlKey: true }, undefined, 'previous-tab'],
  ['linux recent', linux, { key: 'Tab', code: 'Tab', ctrlKey: true }, undefined, 'previous-recent-tab'],
  ['linux index-1', linux, { key: '1', code: 'Digit1', altKey: true }, undefined, 'select-index:0'],
  ['linux close-all-tabs', linux, { key: 'w', code: 'KeyW', ctrlKey: true, altKey: true }, undefined, 'close-all-tabs'],
  ['linux next-tab cycler', linux, { key: ']', code: 'BracketRight', ctrlKey: true, altKey: true }, undefined, 'next-tab'],
  ['linux previous-tab cycler', linux, { key: '[', code: 'BracketLeft', ctrlKey: true, altKey: true }, undefined, 'previous-tab'],
  ['linux zoom-in', linux, { key: '=', code: 'Equal', ctrlKey: true }, undefined, 'zoom-in'],
  ['linux zoom-out', linux, { key: '-', code: 'Minus', ctrlKey: true }, undefined, 'zoom-out'],
  ['linux zoom-reset', linux, { key: '0', code: 'Digit0', ctrlKey: true }, undefined, 'zoom-reset'],
  ['linux toggle', linux, { key: 'j', code: 'KeyJ', ctrlKey: true }, undefined, 'toggle-terminals'],
  ['linux toggle leaves Ctrl+J to the shell', linux, { key: 'j', code: 'KeyJ', ctrlKey: true }, { inTerminal: true }, 'engine'],
  ['linux toggle backquote', linux, { key: '`', code: 'Backquote', ctrlKey: true }, { inTerminal: true }, 'toggle-terminals'],
  ['win32 copy-shift', win, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true }, undefined, 'copy'],
  ['win32 copy-selection', win, { key: 'c', code: 'KeyC', ctrlKey: true }, { hasSelection: true }, 'copy'],
  ['win32 select-all', win, { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true }, undefined, 'select-all'],
  ['win32 paste', win, { key: 'v', code: 'KeyV', ctrlKey: true }, undefined, 'paste'],
  ['win32 paste-shift', win, { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true }, undefined, 'paste'],
  ['win32 paste-insert', win, { key: 'Insert', code: 'Insert', shiftKey: true }, undefined, 'paste'],
  ['win32 search', win, { key: 'f', code: 'KeyF', ctrlKey: true }, undefined, 'search'],
  ['win32 clear', win, { key: 'k', code: 'KeyK', ctrlKey: true }, undefined, 'clear'],
  ['win32 focus-next', win, { key: ']', code: 'BracketRight', ctrlKey: true }, undefined, 'focus-next'],
  ['win32 focus-previous', win, { key: '[', code: 'BracketLeft', ctrlKey: true }, undefined, 'focus-previous'],
  ['win32 expand', win, { key: 'Enter', code: 'Enter', ctrlKey: true, shiftKey: true }, undefined, 'expand-pane'],
  ['win32 close', win, { key: 'w', code: 'KeyW', ctrlKey: true }, undefined, 'close-pane'],
  ['win32 split-right', win, { key: 'd', code: 'KeyD', ctrlKey: true, shiftKey: true }, undefined, 'split-right'],
  ['win32 split-down', win, { key: 'd', code: 'KeyD', altKey: true, shiftKey: true }, undefined, 'split-down'],
  ['win32 new-tab', win, { key: 't', code: 'KeyT', ctrlKey: true }, undefined, 'new-tab'],
  ['win32 reopen', win, { key: 't', code: 'KeyT', ctrlKey: true, shiftKey: true }, undefined, 'reopen-tab'],
  ['win32 next-tab', win, { key: 'PageDown', code: 'PageDown', ctrlKey: true }, undefined, 'next-tab'],
  ['win32 previous-tab', win, { key: 'PageUp', code: 'PageUp', ctrlKey: true }, undefined, 'previous-tab'],
  ['win32 recent', win, { key: 'Tab', code: 'Tab', ctrlKey: true }, undefined, 'previous-recent-tab'],
  ['win32 index-1', win, { key: '1', code: 'Digit1', altKey: true }, undefined, 'select-index:0'],
  ['win32 close-all-tabs', win, { key: 'w', code: 'KeyW', ctrlKey: true, altKey: true }, undefined, 'close-all-tabs'],
  ['win32 next-tab cycler', win, { key: ']', code: 'BracketRight', ctrlKey: true, altKey: true }, undefined, 'next-tab'],
  ['win32 zoom-in plus', win, { key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }, undefined, 'zoom-in'],
  ['win32 zoom-reset', win, { key: '0', code: 'Digit0', ctrlKey: true }, undefined, 'zoom-reset'],
  ['win32 toggle', win, { key: 'j', code: 'KeyJ', ctrlKey: true }, undefined, 'toggle-terminals'],
  ['win32 toggle leaves Ctrl+J to the shell', win, { key: 'j', code: 'KeyJ', ctrlKey: true }, { inTerminal: true }, 'engine'],
  ['win32 toggle backquote', win, { key: '`', code: 'Backquote', ctrlKey: true }, { inTerminal: true }, 'toggle-terminals'],
  ['shift-enter kitty', mac, { key: 'Enter', code: 'Enter', shiftKey: true }, { kitty: true }, escTail('[13;2u')],
  ['shift-enter plain', mac, { key: 'Enter', code: 'Enter', shiftKey: true }, undefined, [ESC, 0x0d]],
  ['shift-enter linux', linux, { key: 'Enter', code: 'Enter', shiftKey: true }, undefined, [ESC, 0x0d]],
  ['ctrl-enter', mac, { key: 'Enter', code: 'Enter', ctrlKey: true }, undefined, escTail('[13;5u')],
  ['ctrl-backspace', mac, { key: 'Backspace', code: 'Backspace', ctrlKey: true }, undefined, [0x17]],
  ['cmd-backspace', mac, { key: 'Backspace', code: 'Backspace', metaKey: true }, undefined, [0x15]],
  ['cmd-delete', mac, { key: 'Delete', code: 'Delete', metaKey: true }, undefined, [0x0b]],
  ['cmd-left', mac, { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }, undefined, [0x01]],
  ['cmd-right', mac, { key: 'ArrowRight', code: 'ArrowRight', metaKey: true }, undefined, [0x05]],
  ['cmd-up', mac, { key: 'ArrowUp', code: 'ArrowUp', metaKey: true }, undefined, 'scroll-top'],
  ['cmd-down', mac, { key: 'ArrowDown', code: 'ArrowDown', metaKey: true }, undefined, 'scroll-bottom'],
  ['interrupt russian', linux, { key: 'с', code: 'KeyC', ctrlKey: true }, undefined, 'interrupt'],
  ['interrupt plain', linux, { key: 'c', code: 'KeyC', ctrlKey: true }, undefined, 'interrupt'],
  ['interrupt mac', mac, { key: 'c', code: 'KeyC', ctrlKey: true }, undefined, 'interrupt'],
  ['control greek', linux, { key: 'α', code: 'KeyA', ctrlKey: true }, undefined, [0x01]],
  ['alt-backspace', linux, { key: 'Backspace', code: 'Backspace', altKey: true }, undefined, [ESC, 0x7f]],
  ['alt-backspace kitty', linux, { key: 'Backspace', code: 'Backspace', altKey: true }, { kitty: true }, 'engine'],
  ['alt-left', linux, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }, undefined, escTail('b')],
  ['alt-right', linux, { key: 'ArrowRight', code: 'ArrowRight', altKey: true }, undefined, escTail('f')],
  ['alt-left kitty', linux, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }, { kitty: true }, 'engine'],
  ['ctrl-left linux', linux, { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true }, undefined, escTail('b')],
  ['ctrl-right linux', linux, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true }, undefined, escTail('f')],
  ['ctrl-left mac', mac, { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true }, undefined, 'engine'],
  ['repeat split', mac, { key: 'd', code: 'KeyD', metaKey: true, repeat: true }, undefined, 'engine'],
  ['repeat select-all', mac, { key: 'a', code: 'KeyA', metaKey: true, repeat: true }, undefined, 'select-all'],
  ['first clear stays', macFirst, { key: 'k', code: 'KeyK', metaKey: true }, undefined, 'clear'],
  ['first new-tab yields', macFirst, { key: 't', code: 'KeyT', metaKey: true }, undefined, 'engine'],
  ['first reopen yields', macFirst, { key: 't', code: 'KeyT', metaKey: true, shiftKey: true }, undefined, 'engine'],
  ['first index yields', linuxFirst, { key: '1', code: 'Digit1', altKey: true }, undefined, 'engine'],
  ['first copy stays', macFirst, { key: 'c', code: 'KeyC', metaKey: true }, undefined, 'copy'],
  ['first paste stays', linuxFirst, { key: 'v', code: 'KeyV', ctrlKey: true }, undefined, 'paste'],
  ['first recent stays', linuxFirst, { key: 'Tab', code: 'Tab', ctrlKey: true }, undefined, 'previous-recent-tab'],
  ['first toggle stays', macFirst, { key: 'j', code: 'KeyJ', metaKey: true }, undefined, 'toggle-terminals'],
  ['first Ctrl+J outside stays', linuxFirst, { key: 'j', code: 'KeyJ', ctrlKey: true }, undefined, 'toggle-terminals'],
  ['first Ctrl+J inside yields', linuxFirst, { key: 'j', code: 'KeyJ', ctrlKey: true }, { inTerminal: true }, 'engine'],
  ['first close-all-tabs yields', macFirst, { key: 'w', code: 'KeyW', metaKey: true, altKey: true }, undefined, 'engine'],
  ['first cycler yields', macFirst, { key: ']', code: 'BracketRight', metaKey: true, altKey: true }, undefined, 'engine'],
  ['first page-down stays', macFirst, { key: 'PageDown', code: 'PageDown', ctrlKey: true }, undefined, 'next-tab'],
  ['first zoom stays', linuxFirst, { key: '-', code: 'Minus', ctrlKey: true }, undefined, 'zoom-out'],
  ['option period', mac, { key: '≥', code: 'Period', altKey: true }, { layout: 'us' }, escTail('.')],
  ['option slash', mac, { key: '÷', code: 'Slash', altKey: true }, { layout: 'us' }, escTail('/')],
  ['option backquote', mac, { key: '`', code: 'Backquote', altKey: true }, { layout: 'us' }, escTail('`')],
  ['option space', mac, { key: ' ', code: 'Space', altKey: true }, { layout: 'us' }, [ESC, 0x20]],
  ['alt-shift-left yields', linux, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, shiftKey: true }, undefined, 'engine'],
  ['alt-shift-right yields', mac, { key: 'ArrowRight', code: 'ArrowRight', altKey: true, shiftKey: true }, undefined, 'engine'],
  ['option compose keeps', mac, { key: '@', code: 'KeyL', altKey: true }, { layout: 'non-us' }, 'engine'],
  ['option us alt', mac, { key: '∫', code: 'KeyB', altKey: true }, { layout: 'us' }, escTail('b')],
  ['option compose word-nav', mac, { key: 'ﬁ', code: 'KeyF', altKey: true }, { layout: 'non-us' }, escTail('f')],
  ['option unknown safe', mac, { key: '@', code: 'KeyL', altKey: true }, undefined, 'engine'],
  ['option kitty yields', mac, { key: '∫', code: 'KeyB', altKey: true }, { layout: 'us', kitty: true }, 'engine'],
  ['tab new-tab', tabMac, { key: '†', code: 'KeyT', altKey: true }, undefined, 'new-tab'],
  ['tab new-tab latin', tabLinux, { key: 't', code: 'KeyT', altKey: true }, undefined, 'new-tab'],
  ['tab close', tabMac, { key: '∑', code: 'KeyW', altKey: true }, undefined, 'close-pane'],
  ['tab reopen', tabMac, { key: '‚', code: 'KeyW', altKey: true, shiftKey: true }, undefined, 'reopen-tab'],
  ['tab rename', tabMac, { key: '®', code: 'KeyR', altKey: true }, undefined, 'rename-tab'],
  ['tab next-tab', tabMac, { key: 'PageDown', code: 'PageDown', altKey: true }, undefined, 'next-tab'],
  ['tab previous-tab', tabLinux, { key: 'PageUp', code: 'PageUp', altKey: true }, undefined, 'previous-tab'],
  ['tab recent', tabMac, { key: 'œ', code: 'KeyQ', altKey: true }, undefined, 'previous-recent-tab'],
  ['tab desktop new-tab yields', tabMac, { key: 't', code: 'KeyT', metaKey: true }, undefined, 'engine'],
  ['tab desktop close yields', tabLinux, { key: 'w', code: 'KeyW', ctrlKey: true }, undefined, 'engine'],
  ['tab desktop recent yields', tabMac, { key: 'Tab', code: 'Tab', ctrlKey: true }, undefined, 'engine'],
  ['tab desktop rename yields', tabMac, { key: 'r', code: 'KeyR', metaKey: true }, undefined, 'engine'],
  ['tab index', tabLinux, { key: '1', code: 'Digit1', altKey: true, shiftKey: true }, undefined, 'select-index:0'],
  ['tab index nine', tabWin, { key: '9', code: 'Digit9', altKey: true, shiftKey: true }, undefined, 'select-index:8'],
  ['tab index darwin', tabMac, { key: '3', code: 'Digit3', ctrlKey: true }, undefined, 'select-index:2'],
  ['tab desktop index yields', tabLinux, { key: '1', code: 'Digit1', altKey: true }, undefined, 'engine'],
];

describe('TerminalKeymap', () => {
  test.each(CASES)('%s', (_label, keymap, event, context, want) => {
    expect(summarize(keymap.resolve(event, context ?? {}))).toEqual(want);
  });

  test('probe prefers the input source ID over the fingerprint', () => {
    const us = new Map([
      ['KeyQ', 'q'],
      ['KeyW', 'w'],
      ['KeyA', 'a'],
      ['KeyZ', 'z'],
      ['Semicolon', ';'],
      ['Quote', "'"],
      ['Backquote', '`'],
      ['BracketLeft', '['],
      ['BracketRight', ']'],
    ]);
    expect(detectLayoutCategory(us)).toBe('us');
    expect(detectLayoutCategory(us, 'com.apple.keylayout.ABC')).toBe('non-us');
    expect(detectLayoutCategory(null, 'com.apple.keylayout.USInternational-PC')).toBe('us');
    const german = new Map(us).set('Semicolon', 'ö');
    expect(detectLayoutCategory(german)).toBe('non-us');
    expect(detectLayoutCategory(new Map())).toBe('unknown');
    expect(detectLayoutCategory(null)).toBe('unknown');
  });

  test('auto resolves through the probe with the compose-safe default', () => {
    expect(effectiveMacOptionAsAlt('auto', 'us')).toBe('true');
    expect(effectiveMacOptionAsAlt('auto', 'non-us')).toBe('false');
    expect(effectiveMacOptionAsAlt('auto', 'unknown')).toBe('false');
    expect(effectiveMacOptionAsAlt('left', 'us')).toBe('left');
  });

  test('menus print the desktop chord on a desktop host and the alternate on a tab host', () => {
    expect(mac.chordLabel('new-tab')).toBe('⌘T');
    expect(tabMac.chordLabel('new-tab')).toBe('⌥T');
    expect(tabMac.chordLabel('reopen-tab')).toBe('⌥⇧W');
    expect(tabLinux.chordLabel('close-pane')).toBe('Alt+W');
    expect(linux.chordLabel('rename-tab')).toBe(null);
    expect(linux.chordLabel('toggle-terminals')).toBe('Ctrl+`');
    expect(mac.chordLabel('toggle-terminals')).toBe('⌘J');
    expect(mac.chordLabel('zoom-in')).toBe('⌘=');
    expect(mac.chordLabel('zoom-out')).toBe('⌘-');
    expect(mac.chordLabel('close-all-tabs')).toBe('⌥⌘W');
    expect(tabMac.chordLabel('zoom-reset')).toBe('⌘0');
  });
});
