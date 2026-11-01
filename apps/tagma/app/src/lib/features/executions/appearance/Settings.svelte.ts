import type { ITheme, ITerminalOptions } from '@xterm/xterm';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import {
  DEFAULT_DIVIDER_DARK,
  DEFAULT_DIVIDER_LIGHT,
  DEFAULT_THEME_DARK,
  DEFAULT_THEME_LIGHT,
  terminalActivePaneOpacity,
  terminalBackgroundOpacity,
  terminalColorOverrides,
  terminalCursorBlink,
  terminalCursorOpacity,
  terminalCursorStyle,
  terminalDividerColorDark,
  terminalDividerColorLight,
  terminalDividerThicknessPx,
  terminalFastScrollSensitivity,
  terminalFocusFollowsMouse,
  terminalFontFamily,
  terminalFontSize,
  terminalFontWeight,
  terminalFontWeightBold,
  terminalGpuAcceleration,
  terminalInactivePaneOpacity,
  terminalLigatures,
  terminalLineHeight,
  terminalMacOptionAsAlt,
  terminalOpacityTransitionMs,
  terminalPaddingX,
  terminalPaddingY,
  terminalScrollbackRows,
  terminalScrollSensitivity,
  terminalThemeDark,
  terminalThemeLight,
  terminalTuiScrollSensitivity,
  terminalUseSeparateLightTheme,
  type TerminalColorOverrides,
  type TerminalGpuAcceleration,
  type TerminalMacOptionAsAlt,
  type TerminalShortcutPolicy,
} from '@tagma/server/executions/contract/wire/terminalAppearance';
import {
  terminalAllowOsc52Clipboard,
  terminalClipboardOnSelect,
  terminalMouseHideWhileTyping,
  terminalRightClickToPaste,
  terminalShortcutPolicy,
  terminalWordSeparator,
} from '@tagma/server/executions/contract/wire/terminalBehavior';
import type { SettingEntry as ServedEntry } from '@tagma/server/settings/contract/wire/catalog';
import { SettingsRepo, writtenCatalog } from '$lib/features/settings/SettingsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { catalogTheme } from '$lib/shared/terminalThemes.js';
import { Theme } from '$lib/shared/Theme.svelte.js';
import {
  ligaturesEnabled,
  terminalFontFamily as buildFontFamily,
  terminalMinimumContrastRatio,
  type EngineOptions,
} from '../terminal/engineOptions.js';
import { SCROLLBAR_INK } from '../terminal/canvasInk.js';

export type AppearancePane = {
  readonly id: string;
  applyOptions(options: ITerminalOptions): void;
  applyTheme(theme: ITheme): void;
  hasBox(): boolean;
  fit(): void;
};

export type MetricOptions = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontWeightBold: number;
  lineHeight: number;
};

export type TitleTone = 'light' | 'dark';

export type PaneStyle = {
  inactivePaneOpacity: number;
  activePaneOpacity: number;
  opacityTransitionMs: number;
  dividerThicknessPx: number;
  focusFollowsMouse: boolean;
  paddingX: number;
  paddingY: number;
};

const ZOOM_MIN_PX = 8;
const ZOOM_MAX_PX = 32;
const ZOOM_STEP_PX = 1;
const HEX_COLOR = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const GROUND_FILL = 'var(--color-background)';

export class TerminalAppearance extends Service<TerminalAppearance>()('TerminalAppearance', { tier: 'app' }) {
  static *make() {
    return new TerminalAppearance(yield* SettingsRepo, yield* Workspace, yield* Theme);
  }

  known = $state(false);
  paneBackground = $state(GROUND_FILL);
  paneFill = $state(GROUND_FILL);
  dividerColor = $state(DEFAULT_DIVIDER_DARK);
  titleTone = $state<TitleTone>('dark');

  private entries: readonly ServedEntry[] = [];
  private surface: 'dark' | 'light' = 'dark';
  private readonly panes = new Set<AppearancePane>();
  private readonly zoomByPane = new Map<string, number>();
  private readonly parkedMetrics = new WeakMap<AppearancePane, MetricOptions>();
  private readonly lastTheme = new WeakMap<AppearancePane, ITheme>();
  private readonly lastContrast = new WeakMap<AppearancePane, number>();

  constructor(
    private readonly repo: SettingsRepo,
    private readonly workspace: Workspace,
    theme: Theme,
  ) {
    super();
    this.surface = theme.mode;
    $effect(() => {
      const next = theme.mode;
      untrack(() => {
        if (next === this.surface) return;
        this.surface = next;
        this.applyAll();
      });
    });
    $effect(() => {
      const projectId = this.workspace.contextProject?.id;
      if (projectId === undefined) return;
      const loaded = this.repo.catalog.key(projectId).data;
      const catalog = writtenCatalog(this.repo, projectId) ?? loaded;
      if (!catalog) return;
      untrack(() => {
        this.take(catalog.entries);
        this.applyAll();
      });
    });
  }

  async refresh(): Promise<void> {
    const projectId = this.workspace.contextProject?.id;
    if (projectId === undefined) return;
    const catalog = await this.repo.catalog.key(projectId).refresh();
    if (catalog) this.take(catalog.entries);
    this.applyAll();
  }

  register(pane: AppearancePane): () => void {
    this.panes.add(pane);
    this.apply(pane);
    return () => {
      this.panes.delete(pane);
      this.parkedMetrics.delete(pane);
      this.lastTheme.delete(pane);
      this.lastContrast.delete(pane);
    };
  }

  parked(pane: AppearancePane): MetricOptions | undefined {
    return this.parkedMetrics.get(pane);
  }

  options(pane: string | null = null): EngineOptions {
    const wordSeparator = String(this.read(terminalWordSeparator.id, terminalWordSeparator.fallback));
    return {
      fontFamily: String(this.read(terminalFontFamily.id, terminalFontFamily.fallback)),
      fontSize: this.sizeFor(pane),
      fontWeight: clampWeight(this.read(terminalFontWeight.id, terminalFontWeight.fallback)),
      fontWeightBold: clampWeight(this.read(terminalFontWeightBold.id, terminalFontWeightBold.fallback)),
      lineHeight: clampLineHeight(this.read(terminalLineHeight.id, terminalLineHeight.fallback)),
      scrollback: this.read(terminalScrollbackRows.id, terminalScrollbackRows.fallback),
      cursorStyle: this.read(terminalCursorStyle.id, terminalCursorStyle.fallback),
      cursorBlink: this.read(terminalCursorBlink.id, terminalCursorBlink.fallback),
      scrollSensitivity: this.read(terminalScrollSensitivity.id, terminalScrollSensitivity.fallback),
      fastScrollSensitivity: this.read(terminalFastScrollSensitivity.id, terminalFastScrollSensitivity.fallback),
      macOptionIsMeta: this.read(terminalMacOptionAsAlt.id, terminalMacOptionAsAlt.fallback) === 'true',
      theme: this.theme(),
      surface: this.surface,
      ligatures: this.read(terminalLigatures.id, terminalLigatures.fallback),
      wordSeparator,
    };
  }

  theme(): ITheme {
    const slot = this.slot();
    const name =
      slot === 'light'
        ? String(this.read(terminalThemeLight.id, terminalThemeLight.fallback))
        : String(this.read(terminalThemeDark.id, terminalThemeDark.fallback));
    const fallbackName = slot === 'light' ? DEFAULT_THEME_LIGHT : DEFAULT_THEME_DARK;
    const base = catalogTheme(name)?.theme ?? catalogTheme(fallbackName)?.theme ?? catalogTheme(DEFAULT_THEME_DARK)!.theme;
    return composeTheme(base, this.read(terminalColorOverrides.id, terminalColorOverrides.fallback), {
      background: this.read(terminalBackgroundOpacity.id, terminalBackgroundOpacity.fallback),
      cursor: this.read(terminalCursorOpacity.id, terminalCursorOpacity.fallback),
    });
  }

  ligaturesOn(): boolean {
    return ligaturesEnabled(
      this.read(terminalLigatures.id, terminalLigatures.fallback),
      String(this.read(terminalFontFamily.id, terminalFontFamily.fallback)),
    );
  }

  webgl(): TerminalGpuAcceleration {
    return this.read(terminalGpuAcceleration.id, terminalGpuAcceleration.fallback);
  }

  keymapPolicy(): TerminalShortcutPolicy {
    return this.read(terminalShortcutPolicy.id, terminalShortcutPolicy.fallback);
  }

  macOptionAsAlt(): TerminalMacOptionAsAlt {
    return this.read(terminalMacOptionAsAlt.id, terminalMacOptionAsAlt.fallback);
  }

  wheelSensitivity(): number {
    return this.read(terminalTuiScrollSensitivity.id, terminalTuiScrollSensitivity.fallback);
  }

  osc52(): boolean {
    return this.read(terminalAllowOsc52Clipboard.id, terminalAllowOsc52Clipboard.fallback);
  }

  clipboardOnSelect(): boolean {
    return this.read(terminalClipboardOnSelect.id, terminalClipboardOnSelect.fallback);
  }

  rightClickToPaste(): boolean {
    return this.read(terminalRightClickToPaste.id, terminalRightClickToPaste.fallback);
  }

  mouseHideWhileTyping(): boolean {
    return this.read(terminalMouseHideWhileTyping.id, terminalMouseHideWhileTyping.fallback);
  }

  apply(pane: AppearancePane): void {
    const theme = this.theme();
    this.syncDerived(theme);
    const options = this.options(pane.id);
    if (!themesEqual(this.lastTheme.get(pane), theme)) {
      pane.applyTheme(theme);
      this.lastTheme.set(pane, theme);
    }
    const metrics: MetricOptions = {
      fontFamily: buildFontFamily(options.fontFamily),
      fontSize: options.fontSize ?? 14,
      fontWeight: clampWeight(options.fontWeight),
      fontWeightBold: clampWeight(options.fontWeightBold),
      lineHeight: clampLineHeight(options.lineHeight),
    };
    const minimumContrastRatio = terminalMinimumContrastRatio(theme.background, this.surface);
    const next: ITerminalOptions = {
      scrollback: this.read(terminalScrollbackRows.id, terminalScrollbackRows.fallback),
      scrollSensitivity: options.scrollSensitivity,
      fastScrollSensitivity: options.fastScrollSensitivity,
      cursorStyle: options.cursorStyle,
      cursorInactiveStyle: options.cursorStyle === 'block' ? 'outline' : options.cursorStyle,
      cursorBlink: options.cursorBlink,
      allowTransparency: this.read(terminalBackgroundOpacity.id, terminalBackgroundOpacity.fallback) < 1,
      macOptionIsMeta: options.macOptionIsMeta,
    };
    next.wordSeparator = String(this.read(terminalWordSeparator.id, terminalWordSeparator.fallback));
    if (this.lastContrast.get(pane) !== minimumContrastRatio) {
      next.minimumContrastRatio = minimumContrastRatio;
      this.lastContrast.set(pane, minimumContrastRatio);
    }
    if (pane.hasBox()) {
      this.parkedMetrics.delete(pane);
      Object.assign(next, metrics);
    } else {
      this.parkedMetrics.set(pane, metrics);
    }
    pane.applyOptions(next);
    pane.fit();
  }

  zoom(pane: AppearancePane, direction: 1 | -1): void {
    const next = Math.min(ZOOM_MAX_PX, Math.max(ZOOM_MIN_PX, this.sizeFor(pane.id) + direction * ZOOM_STEP_PX));
    if (next === this.read(terminalFontSize.id, terminalFontSize.fallback)) this.zoomByPane.delete(pane.id);
    else this.zoomByPane.set(pane.id, next);
    this.apply(pane);
  }

  resetZoom(pane: AppearancePane): void {
    this.zoomByPane.delete(pane.id);
    this.apply(pane);
  }

  paneStyle(): PaneStyle {
    return {
      inactivePaneOpacity: this.read(terminalInactivePaneOpacity.id, terminalInactivePaneOpacity.fallback),
      activePaneOpacity: this.read(terminalActivePaneOpacity.id, terminalActivePaneOpacity.fallback),
      opacityTransitionMs: this.read(terminalOpacityTransitionMs.id, terminalOpacityTransitionMs.fallback),
      dividerThicknessPx: this.read(terminalDividerThicknessPx.id, terminalDividerThicknessPx.fallback),
      focusFollowsMouse: this.read(terminalFocusFollowsMouse.id, terminalFocusFollowsMouse.fallback),
      paddingX: this.read(terminalPaddingX.id, terminalPaddingX.fallback),
      paddingY: this.read(terminalPaddingY.id, terminalPaddingY.fallback),
    };
  }

  private take(entries: readonly ServedEntry[]): void {
    this.entries = entries;
    this.known = true;
  }

  private read<A>(id: string, fallback: A): A {
    const entry = this.entries.find((row) => row.id === id);
    return entry === undefined ? fallback : (entry.value as A);
  }

  private sizeFor(pane: string | null): number {
    if (pane !== null) {
      const zoomed = this.zoomByPane.get(pane);
      if (zoomed !== undefined) return zoomed;
    }
    return this.read(terminalFontSize.id, terminalFontSize.fallback);
  }

  private slot(): 'dark' | 'light' {
    return this.surface === 'light' && this.read(terminalUseSeparateLightTheme.id, terminalUseSeparateLightTheme.fallback)
      ? 'light'
      : 'dark';
  }

  private syncDerived(theme: ITheme): void {
    this.paneBackground = theme.background ?? GROUND_FILL;
    this.paneFill = this.read(terminalBackgroundOpacity.id, terminalBackgroundOpacity.fallback) < 1 ? 'transparent' : this.paneBackground;
    this.dividerColor =
      this.slot() === 'light'
        ? String(this.read(terminalDividerColorLight.id, terminalDividerColorLight.fallback) || DEFAULT_DIVIDER_LIGHT)
        : String(this.read(terminalDividerColorDark.id, terminalDividerColorDark.fallback) || DEFAULT_DIVIDER_DARK);
    this.titleTone = terminalMinimumContrastRatio(theme.background, this.surface) === 4.5 ? 'light' : 'dark';
  }

  private applyAll(): void {
    for (const pane of this.panes) this.apply(pane);
  }
}

export function composeTheme(base: ITheme, overrides: TerminalColorOverrides, opacity: { background: number; cursor: number }): ITheme {
  let theme: ITheme = {
    overviewRulerBorder: 'transparent',
    ...SCROLLBAR_INK,
    ...base,
    ...overrides,
  };
  if (theme.background) theme = { ...theme, background: withAlpha(theme.background, opacity.background) };
  if (theme.cursor && HEX_COLOR.test(theme.cursor)) theme = { ...theme, cursor: withAlpha(theme.cursor, opacity.cursor) };
  return theme;
}

export function themesEqual(a: ITheme | undefined, b: ITheme): boolean {
  if (!a) return false;
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === 'extendedAnsi') continue;
    if (a[key as keyof ITheme] !== b[key as keyof ITheme]) return false;
  }
  const extA = a.extendedAnsi;
  const extB = b.extendedAnsi;
  if (!extA || !extB) return extA === extB;
  return extA.length === extB.length && extA.every((value, i) => value === extB[i]);
}

function withAlpha(hex: string, alpha: number): string {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${clean.toLowerCase()}${byte}`;
}

function clampWeight(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 500;
  return Math.min(900, Math.max(100, Math.round(value)));
}

function clampLineHeight(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(3, Math.max(1, value));
}
