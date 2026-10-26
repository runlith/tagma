import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey, type SettingColorGroup } from '../../../platform/contract/wire/setting.js';

const TERMINAL_SCOPES = SETTABLE_SCOPES;

const HEX_COLOR = Schema.String.check(Schema.isPattern(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u));

const TERMINAL_COLOR_GROUPS = [
  {
    label: 'Base',
    slots: [
      { key: 'foreground', label: 'Foreground' },
      { key: 'background', label: 'Background' },
      { key: 'cursor', label: 'Cursor' },
      { key: 'cursorAccent', label: 'Cursor text', hint: 'The character under a block cursor.' },
      { key: 'selectionBackground', label: 'Selection background' },
      { key: 'selectionForeground', label: 'Selection text' },
      {
        key: 'bold',
        label: 'Bold text',
        hint: 'Stored, and nothing paints with it: the engine has no bold colour.',
      },
    ],
  },
  {
    label: 'ANSI normal',
    slots: [
      { key: 'black', label: 'Black' },
      { key: 'red', label: 'Red' },
      { key: 'green', label: 'Green' },
      { key: 'yellow', label: 'Yellow' },
      { key: 'blue', label: 'Blue' },
      { key: 'magenta', label: 'Magenta' },
      { key: 'cyan', label: 'Cyan' },
      { key: 'white', label: 'White' },
    ],
  },
  {
    label: 'ANSI bright',
    slots: [
      { key: 'brightBlack', label: 'Bright black' },
      { key: 'brightRed', label: 'Bright red' },
      { key: 'brightGreen', label: 'Bright green' },
      { key: 'brightYellow', label: 'Bright yellow' },
      { key: 'brightBlue', label: 'Bright blue' },
      { key: 'brightMagenta', label: 'Bright magenta' },
      { key: 'brightCyan', label: 'Bright cyan' },
      { key: 'brightWhite', label: 'Bright white' },
    ],
  },
] as const satisfies readonly SettingColorGroup[];

type TerminalColorSlot = (typeof TERMINAL_COLOR_GROUPS)[number]['slots'][number]['key'];

export const TerminalColorOverrides = Schema.Struct(
  Object.fromEntries(TERMINAL_COLOR_GROUPS.flatMap((group) => group.slots.map((slot) => [slot.key, Schema.optionalKey(HEX_COLOR)]))) as {
    [K in TerminalColorSlot]: Schema.optionalKey<typeof HEX_COLOR>;
  },
);
export type TerminalColorOverrides = typeof TerminalColorOverrides.Type;

const CURSOR_STYLES = ['bar', 'block', 'underline'] as const;
export type TerminalCursorStyle = (typeof CURSOR_STYLES)[number];

const LIGATURE_MODES = ['auto', 'on', 'off'] as const;
export type TerminalLigatures = (typeof LIGATURE_MODES)[number];

const GPU_MODES = ['auto', 'on', 'off'] as const;
export type TerminalGpuAcceleration = (typeof GPU_MODES)[number];

export const OPTION_AS_ALT = ['auto', 'true', 'false', 'left', 'right'] as const;
export type TerminalMacOptionAsAlt = (typeof OPTION_AS_ALT)[number];

export const SHORTCUT_POLICIES = ['app-first', 'terminal-first'] as const;
export type TerminalShortcutPolicy = (typeof SHORTCUT_POLICIES)[number];

export const DEFAULT_THEME_DARK = 'Tagma Dark';
export const DEFAULT_THEME_LIGHT = 'Tagma Light';
export const DEFAULT_DIVIDER_DARK = '#3f3f46';
export const DEFAULT_DIVIDER_LIGHT = '#d4d4d8';

export const terminalFontFamily = settingKey({
  id: 'terminal.fontFamily',
  order: 160,
  title: 'Font family',
  description: 'The first family in the engine stack; empty uses the cross-platform monospace chain behind it.',
  schema: Schema.String,
  fallback: '',
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalFontSize = settingKey({
  id: 'terminal.fontSize',
  order: 170,
  title: 'Font size',
  description: 'Engine size in pixels, and the size every pane starts at; zooming one pane reaches 8–32 from here.',
  schema: Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 24 })),
  control: { kind: 'slider', minimum: 10, maximum: 24, step: 1 },
  fallback: 14,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalFontWeight = settingKey({
  id: 'terminal.fontWeight',
  order: 180,
  title: 'Regular weight',
  description: 'Engine regular face, 100–900.',
  schema: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 900 })),
  control: { kind: 'slider', minimum: 100, maximum: 900, step: 100 },
  fallback: 500,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalFontWeightBold = settingKey({
  id: 'terminal.fontWeightBold',
  order: 190,
  title: 'Bold weight',
  description: 'Engine bold face, independently of regular weight.',
  schema: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 900 })),
  control: { kind: 'slider', minimum: 100, maximum: 900, step: 100 },
  fallback: 700,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalLineHeight = settingKey({
  id: 'terminal.lineHeight',
  order: 200,
  title: 'Line height',
  description: 'Engine line height, clamped 1–3.',
  schema: Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 3 })),
  control: { kind: 'slider', minimum: 1, maximum: 3, step: 0.05 },
  fallback: 1,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalLigatures = settingKey({
  id: 'terminal.ligatures',
  order: 210,
  title: 'Ligatures',
  description: 'Programming ligatures: auto follows fonts known to ship them; on and off never follow the family.',
  schema: Schema.Literals(LIGATURE_MODES),
  control: {
    kind: 'choice',
    choices: [
      { value: 'auto', label: 'Auto', hint: 'On only when the family is known to ship ligatures.' },
      { value: 'on', label: 'On', hint: 'Always render ligatures, whatever the family.' },
      { value: 'off', label: 'Off', hint: 'Never render ligatures, even after switching family.' },
    ],
  },
  fallback: 'auto' as TerminalLigatures,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalScrollbackRows = settingKey({
  id: 'terminal.scrollbackRows',
  order: 220,
  title: 'Scrollback',
  description: 'Rows the engine keeps above the viewport; the backlog cap scales with this figure.',
  schema: Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 50_000 })),
  control: { kind: 'slider', minimum: 1000, maximum: 50_000, step: 1000 },
  fallback: 5000,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalScrollSensitivity = settingKey({
  id: 'terminal.scrollSensitivity',
  order: 230,
  title: 'Scroll sensitivity',
  description: 'Engine wheel multiplier for ordinary scrolling.',
  schema: Schema.Number.check(Schema.isBetween({ minimum: 0.5, maximum: 3 })),
  control: { kind: 'slider', minimum: 0.5, maximum: 3, step: 0.05 },
  fallback: 1.15,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalFastScrollSensitivity = settingKey({
  id: 'terminal.fastScrollSensitivity',
  order: 240,
  title: 'Fast-scroll sensitivity',
  description: 'Engine wheel multiplier while a fast-scroll modifier is held.',
  schema: Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  control: { kind: 'slider', minimum: 1, maximum: 10, step: 0.5 },
  fallback: 5,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalTuiScrollSensitivity = settingKey({
  id: 'terminal.tuiScrollSensitivity',
  order: 250,
  title: 'TUI scroll sensitivity',
  description: 'Multiplier for wheel reports a TUI receives, 1–10.',
  schema: Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  control: { kind: 'slider', minimum: 1, maximum: 10, step: 1 },
  fallback: 1,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalCursorStyle = settingKey({
  id: 'terminal.cursorStyle',
  order: 260,
  title: 'Cursor shape',
  description: 'Engine cursor: bar, block or underline.',
  schema: Schema.Literals(CURSOR_STYLES),
  control: {
    kind: 'choice',
    choices: [
      { value: 'block', label: 'Block', hint: 'A filled cell; inactive panes draw an outline of it.' },
      { value: 'bar', label: 'Bar', hint: 'A vertical bar; inactive panes keep the same stroke.' },
      { value: 'underline', label: 'Underline', hint: 'A baseline; inactive panes keep the same stroke.' },
    ],
  },
  fallback: 'block' as TerminalCursorStyle,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalCursorBlink = settingKey({
  id: 'terminal.cursorBlink',
  order: 270,
  title: 'Cursor blink',
  description: 'Whether the engine cursor blinks while the pane is focused.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalCursorOpacity = settingKey({
  id: 'terminal.cursorOpacity',
  order: 280,
  title: 'Cursor opacity',
  description: 'Applied as rgba on a hex cursor colour; named CSS colours are left as they stand.',
  schema: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  control: { kind: 'share', minimum: 0, maximum: 1 },
  fallback: 1,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalBackgroundOpacity = settingKey({
  id: 'terminal.backgroundOpacity',
  order: 290,
  title: 'Background opacity',
  description: 'Applied as rgba on the composed background; below 1 turns engine transparency on.',
  schema: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  control: { kind: 'share', minimum: 0, maximum: 1 },
  fallback: 1,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalThemeDark = settingKey({
  id: 'terminal.themeDark',
  order: 300,
  title: 'Dark theme',
  description: 'Catalogue name used when the app is in dark mode, or when a separate light theme is off.',
  schema: Schema.String.check(Schema.isMinLength(1)),
  control: { kind: 'catalog', of: 'terminal-theme' },
  fallback: DEFAULT_THEME_DARK,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalThemeLight = settingKey({
  id: 'terminal.themeLight',
  order: 310,
  title: 'Light theme',
  description: 'Catalogue name used when the app is in light mode and a separate light theme is on.',
  schema: Schema.String.check(Schema.isMinLength(1)),
  control: { kind: 'catalog', of: 'terminal-theme' },
  fallback: DEFAULT_THEME_LIGHT,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalUseSeparateLightTheme = settingKey({
  id: 'terminal.useSeparateLightTheme',
  order: 320,
  title: 'Separate light theme',
  description: 'When off, light app mode keeps the dark-slot theme.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalColorOverrides = settingKey({
  id: 'terminal.colorOverrides',
  order: 330,
  title: 'Colour overrides',
  description: 'Optional hex slots merged onto the catalogue theme (ANSI, foreground, background, cursor, selection, bold).',
  schema: TerminalColorOverrides,
  control: { kind: 'colors', groups: TERMINAL_COLOR_GROUPS },
  fallback: {} as TerminalColorOverrides,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalPaddingX = settingKey({
  id: 'terminal.paddingX',
  order: 340,
  title: 'Padding X',
  description: 'Horizontal padding of the pane container, in pixels.',
  schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  control: { kind: 'slider', minimum: 0, maximum: 32, step: 1 },
  fallback: 4,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalPaddingY = settingKey({
  id: 'terminal.paddingY',
  order: 350,
  title: 'Padding Y',
  description: 'Vertical padding of the pane container, in pixels.',
  schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  control: { kind: 'slider', minimum: 0, maximum: 32, step: 1 },
  fallback: 4,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalDividerThicknessPx = settingKey({
  id: 'terminal.dividerThicknessPx',
  order: 360,
  title: 'Divider thickness',
  description: 'Split divider width in pixels, 1–32.',
  schema: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 })),
  control: { kind: 'slider', minimum: 1, maximum: 32, step: 1 },
  fallback: 1,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalDividerColorDark = settingKey({
  id: 'terminal.dividerColorDark',
  order: 370,
  title: 'Dark divider',
  description: 'Divider colour while the dark theme slot is in force.',
  schema: HEX_COLOR,
  fallback: DEFAULT_DIVIDER_DARK,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalDividerColorLight = settingKey({
  id: 'terminal.dividerColorLight',
  order: 380,
  title: 'Light divider',
  description: 'Divider colour while the light theme slot is in force.',
  schema: HEX_COLOR,
  fallback: DEFAULT_DIVIDER_LIGHT,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalInactivePaneOpacity = settingKey({
  id: 'terminal.inactivePaneOpacity',
  order: 390,
  title: 'Inactive pane opacity',
  description: 'Opacity of a pane that is not the active one.',
  schema: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  control: { kind: 'share', minimum: 0, maximum: 1 },
  fallback: 0.9,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalActivePaneOpacity = settingKey({
  id: 'terminal.activePaneOpacity',
  order: 400,
  title: 'Active pane opacity',
  description: 'Opacity of the focused pane.',
  schema: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  control: { kind: 'share', minimum: 0, maximum: 1 },
  fallback: 1,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalOpacityTransitionMs = settingKey({
  id: 'terminal.opacityTransitionMs',
  order: 410,
  title: 'Pane opacity transition',
  description: 'Milliseconds the pane opacity change takes.',
  schema: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5000 })),
  control: { kind: 'number', minimum: 0, maximum: 5000, step: 10, unit: 'milliseconds' },
  fallback: 140,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalFocusFollowsMouse = settingKey({
  id: 'terminal.focusFollowsMouse',
  order: 420,
  title: 'Focus follows mouse',
  description: 'Moving the pointer into a pane focuses it without a click.',
  schema: Schema.Boolean,
  fallback: false,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalMacOptionAsAlt = settingKey({
  id: 'terminal.macOptionAsAlt',
  order: 430,
  title: 'Option as Alt',
  description: 'macOS Option: auto follows the layout (US → Meta); true is Meta on both; left/right is one side; false composes.',
  schema: Schema.Literals(OPTION_AS_ALT),
  control: {
    kind: 'choice',
    choices: [
      { value: 'auto', label: 'Auto', hint: 'US and US-International-PC send Meta; other layouts compose.' },
      { value: 'true', label: 'Both', hint: 'Both Option keys send Meta.' },
      { value: 'left', label: 'Left', hint: 'Only left Option is Meta; right still composes.' },
      { value: 'right', label: 'Right', hint: 'Only right Option is Meta; left still composes.' },
      { value: 'false', label: 'Off', hint: 'Option always composes layout characters.' },
    ],
  },
  fallback: 'auto' as TerminalMacOptionAsAlt,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});

export const terminalGpuAcceleration = settingKey({
  id: 'terminal.gpuAcceleration',
  order: 440,
  title: 'GPU acceleration',
  description: 'WebGL render policy: auto tries and falls back, on always tries, off stays on the DOM renderer.',
  schema: Schema.Literals(GPU_MODES),
  control: {
    kind: 'choice',
    choices: [
      { value: 'auto', label: 'Auto', hint: 'Try WebGL and fall back to DOM when unsupported or risky.' },
      { value: 'on', label: 'On', hint: 'Always try WebGL.' },
      { value: 'off', label: 'Off', hint: 'Keep the DOM renderer.' },
    ],
  },
  fallback: 'auto' as TerminalGpuAcceleration,
  scopes: TERMINAL_SCOPES,
  merge: 'replace',
});
