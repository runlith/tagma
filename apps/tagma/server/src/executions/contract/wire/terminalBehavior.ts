import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey } from '../../../platform/contract/wire/setting.js';
import { OPTION_AS_ALT, SHORTCUT_POLICIES, type TerminalShortcutPolicy } from './terminalAppearance.js';

const TERMINAL_SCOPES = SETTABLE_SCOPES;

export const terminalClipboardOnSelect = settingKey({
  id: 'terminal.clipboardOnSelect',
  order: 450,
  title: 'Copy on select',
  description: 'Selecting text copies it to the clipboard.',
  schema: Schema.Boolean,
  fallback: false,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalRightClickToPaste = settingKey({
  id: 'terminal.rightClickToPaste',
  order: 460,
  title: 'Right-click paste',
  description: 'Right-click pastes instead of opening the context menu; Windows convention, off elsewhere.',
  schema: Schema.Boolean,
  fallback: false,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalAllowOsc52Clipboard = settingKey({
  id: 'terminal.allowOsc52Clipboard',
  order: 470,
  title: 'OSC 52 clipboard writes',
  description: 'Allow TUIs to write the clipboard over OSC 52; queries stay blocked.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalMouseHideWhileTyping = settingKey({
  id: 'terminal.mouseHideWhileTyping',
  order: 480,
  title: 'Hide pointer while typing',
  description: 'The mouse pointer hides on the keys the person types and returns on the next move.',
  schema: Schema.Boolean,
  fallback: false,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalShortcutPolicy = settingKey({
  id: 'terminal.shortcutPolicy',
  order: 490,
  title: 'Shortcut policy',
  description: 'App-first keeps app chords from TUIs; terminal-first lets the shell win.',
  schema: Schema.Literals(SHORTCUT_POLICIES),
  control: {
    kind: 'choice',
    choices: [
      { value: 'app-first', label: 'App first', hint: 'App shortcuts win over a focused terminal.' },
      { value: 'terminal-first', label: 'Terminal first', hint: 'Shell and TUI bindings win; app chords that collide yield.' },
    ],
  },
  fallback: 'app-first' as TerminalShortcutPolicy,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalWordSeparator = settingKey({
  id: 'terminal.wordSeparator',
  order: 500,
  title: 'Word separators',
  description: 'Characters that break a double-click word; empty keeps xterm’s default.',
  schema: Schema.String,
  fallback: '',
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalSkipCloseConfirm = settingKey({
  id: 'terminal.skipCloseConfirm',
  order: 510,
  title: 'Skip close confirmation',
  description: 'Close a tab with a running process without asking.',
  schema: Schema.Boolean,
  fallback: false,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

type TerminalTabTree =
  | { readonly kind: 'pane'; readonly id: string }
  | {
      readonly kind: 'split';
      readonly direction: 'row' | 'column';
      readonly ratio: number;
      readonly children: readonly [TerminalTabTree, TerminalTabTree];
    };

const terminalTabTree: Schema.Codec<TerminalTabTree> = Schema.suspend((): Schema.Codec<TerminalTabTree> =>
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal('pane'), id: Schema.String }),
    Schema.Struct({
      kind: Schema.Literal('split'),
      direction: Schema.Union([Schema.Literal('row'), Schema.Literal('column')]),
      ratio: Schema.Number,
      children: Schema.Tuple([terminalTabTree, terminalTabTree]),
    }),
  ]),
);

const terminalStoredTab = Schema.Struct({
  title: Schema.Union([Schema.String, Schema.Null]),
  tree: terminalTabTree,
  labels: Schema.Record(Schema.String, Schema.String),
  active: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
});

const terminalPlaceLayout = Schema.Struct({
  order: Schema.Array(Schema.String),
  tabs: Schema.Record(Schema.String, terminalStoredTab),
  closed: Schema.Array(terminalStoredTab),
  shown: Schema.optional(Schema.Boolean),
  active: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
});

export const terminalPlaceLayouts = settingKey({
  id: 'terminal.placeLayouts',
  order: 520,
  title: 'Place layouts',
  description:
    'Written by the terminals themselves: each place’s terminal tabs with their splits and titles, their order, its reopen stack and which tab and pane were last in front, keyed by the place’s root.',
  control: { kind: 'machine' },
  schema: Schema.Struct({ places: Schema.Record(Schema.String, terminalPlaceLayout) }),
  fallback: { places: {} } as {
    readonly places: Readonly<
      Record<
        string,
        {
          readonly order: readonly string[];
          readonly tabs: Readonly<
            Record<
              string,
              {
                readonly title: string | null;
                readonly tree: TerminalTabTree;
                readonly labels: Readonly<Record<string, string>>;
                readonly active?: string | null;
              }
            >
          >;
          readonly closed: readonly {
            readonly title: string | null;
            readonly tree: TerminalTabTree;
            readonly labels: Readonly<Record<string, string>>;
            readonly active?: string | null;
          }[];
          readonly shown?: boolean;
          readonly active?: string | null;
        }
      >
    >;
  },
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalLastGrid = settingKey({
  id: 'terminal.lastGrid',
  order: 535,
  title: 'Last measured grid',
  description: 'Written by the harness terminal itself: the grid its pane last settled at, used as the birth size of the next CLI.',
  control: { kind: 'machine' },
  schema: Schema.NullOr(
    Schema.Struct({
      columns: Schema.Int.check(Schema.isGreaterThan(0)),
      rows: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
  ),
  fallback: null as { readonly columns: number; readonly rows: number } | null,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

const MEMORY_SHARE = {
  minimum: 0.01,
  maximum: 1,
} as const;

export const hostMemoryShare = settingKey({
  id: 'host.memoryShare',
  order: 540,
  title: 'Memory share',
  description:
    'How much of this machine the host may hold for its terminals; when the share runs out it reclaims history from the least-recently-active terminal before it refuses a start.',
  schema: Schema.Number.check(Schema.isBetween({ minimum: MEMORY_SHARE.minimum, maximum: MEMORY_SHARE.maximum })),
  control: { kind: 'share', minimum: MEMORY_SHARE.minimum, maximum: MEMORY_SHARE.maximum },
  fallback: 0.25,
  scopes: ['user'],
  merge: 'replace',
});

export const executionHandshakeMs = 5000;

export const OUTPUT_RETAINED_BYTES = 8 * 1024 * 1024;
