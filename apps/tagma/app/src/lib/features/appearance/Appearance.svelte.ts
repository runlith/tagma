import type { OfferedTheme } from '@tagma/server/appearance/contract/wire/feeds';
import { modeOf, TAGMA_THEME, THEME_MODES, type Theme as ThemeData, type ThemeMode } from '@tagma/server/appearance/contract/wire/format';
import { declarationsOf, resolve } from '@tagma/server/appearance/contract/wire/resolve';
import { type AppearanceMode, appearanceMode, appearanceTheme } from '@tagma/server/appearance/contract/wire/settings';
import type { WatchedSettings } from '@tagma/server/settings/contract/wire/feeds';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Result, Schema } from 'effect';
import { MediaQuery } from 'svelte/reactivity';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { CatalogEntry } from '$lib/features/settings/controls/catalogs.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { Look, ThemePort } from '$lib/shared/Theme.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { type Painting, paintWith, sheetOf } from './paint.js';

const PAINT_KEY = 'appearance.paint';

type BootPaint = {
  readonly choice: AppearanceMode;
  readonly variants: { readonly [M in ThemeMode]?: { readonly declarations: string; readonly chrome: string } };
};

const decodeTheme = Schema.decodeUnknownResult(appearanceTheme.schema);
const decodeMode = Schema.decodeUnknownResult(appearanceMode.schema);

const TAGMA_TITLE = 'Tagma';

export class Appearance extends Service<Appearance>()('Appearance', { tier: 'app' }) implements ThemePort {
  static *make() {
    const appearance = new Appearance(yield* Door, yield* Workspace, yield* Notices, (yield* Platform).storage.local);
    const live = yield* Live;
    const settings = live.hold(
      (client) => client['settings.watch']({ keys: [appearanceTheme.id, appearanceMode.id] }),
      (event) => appearance.heardSettings(event),
      () => undefined,
    );
    const themes = live.hold(
      (client) => client['appearance.subscribe']({}),
      (event) => appearance.heardThemes(event.themes),
      () => undefined,
    );
    (yield* Scope).defer(() => {
      settings.unsubscribe();
      themes.unsubscribe();
    });
    return appearance;
  }

  chosen = $state<string>(TAGMA_THEME);
  choice = $state<AppearanceMode>('system');
  offered = $state<readonly OfferedTheme[]>([]);
  look = $state<Look>({ id: TAGMA_THEME, mode: 'dark', terminal: resolve(undefined, 'dark').terminal });
  private settingsKnown = $state(false);
  private themesKnown = $state(false);
  private readonly light = new MediaQuery('prefers-color-scheme: light');
  private painted: string | null = null;
  private sheet: CSSStyleSheet | null = null;

  constructor(
    private readonly door: Door,
    private readonly workspace: Workspace,
    private readonly notices: Notices,
    private readonly storage: PlatformStorage,
  ) {
    super();
    this.look = { ...this.look, mode: this.mode };
    $effect(() => this.paint());
  }

  get theme(): ThemeData | undefined {
    return this.chosen === TAGMA_THEME ? undefined : this.offered.find((offered) => offered.id === this.chosen)?.theme;
  }

  get missing(): boolean {
    return this.chosen !== TAGMA_THEME && this.themesKnown && this.theme === undefined;
  }

  get shown(): string {
    return this.theme === undefined ? TAGMA_THEME : this.chosen;
  }

  get wanted(): ThemeMode {
    if (this.choice !== 'system') return this.choice;
    return this.light.current ? 'light' : 'dark';
  }

  get mode(): ThemeMode {
    return modeOf(this.theme, this.wanted);
  }

  get onlyLook(): ThemeMode | null {
    const theme = this.theme;
    if (theme === undefined) return null;
    const looks = THEME_MODES.filter((mode) => theme[mode] !== undefined);
    return looks.length === 1 ? looks[0]! : null;
  }

  get title(): string {
    return (
      this.offered.find((offered) => offered.id === this.chosen)?.theme.title ?? (this.chosen === TAGMA_THEME ? TAGMA_TITLE : this.chosen)
    );
  }

  get entries(): readonly CatalogEntry[] {
    return [
      { value: TAGMA_THEME, label: TAGMA_TITLE, group: 'Themes', swatches: this.coloursOf(undefined) },
      ...this.offered.map((offered) => ({
        value: offered.id,
        label: offered.theme.title,
        group: offered.pluginTitle,
        swatches: this.coloursOf(offered.theme),
      })),
    ];
  }

  coloursOf(theme: ThemeData | undefined): readonly string[] {
    const mode = modeOf(theme, this.wanted);
    const { surfaces, text, signals } = resolve(theme?.[mode], mode).palette;
    return [surfaces.background, text.foreground, signals.here, signals.failure, signals.work, signals.done, signals.waiting];
  }

  chooseTheme(id: string): void {
    const before = this.chosen;
    this.chosen = id;
    void this.write(appearanceTheme.id, id, () => (this.chosen = before));
  }

  chooseMode(mode: AppearanceMode): void {
    const before = this.choice;
    this.choice = mode;
    void this.write(appearanceMode.id, mode, () => (this.choice = before));
  }

  paint(): void {
    if (!this.settingsKnown || !this.themesKnown) return;
    const theme = this.theme;
    const mode = this.mode;
    const id = this.shown;
    const choice = this.choice;
    const key = JSON.stringify([id, mode, choice, theme ?? null]);
    if (key === this.painted) return;
    const still = this.painted !== null;
    this.painted = key;
    const shown = resolve(theme?.[mode], mode);
    const painting: Painting = { mode, css: theme === undefined ? '' : `:root{${declarationsOf(shown.tokens)}}`, chrome: shown.chrome };
    this.sheet ??= sheetOf(document);
    paintWith(document, this.sheet, painting, still);
    this.storage.setItem(PAINT_KEY, JSON.stringify(this.bootOf(theme, choice)));
    this.look = { id, mode, terminal: shown.terminal };
  }

  private bootOf(theme: ThemeData | undefined, choice: AppearanceMode): BootPaint {
    const variants = Object.fromEntries(
      THEME_MODES.filter((mode) => theme === undefined || theme[mode] !== undefined).map((mode) => {
        const resolved = resolve(theme?.[mode], mode);
        return [mode, { declarations: theme === undefined ? '' : declarationsOf(resolved.tokens), chrome: resolved.chrome }];
      }),
    );
    return { choice, variants };
  }

  private heardSettings(event: WatchedSettings): void {
    const theme = event.values[appearanceTheme.id];
    const mode = event.values[appearanceMode.id];
    if (theme !== undefined) {
      const decoded = decodeTheme(theme);
      if (Result.isSuccess(decoded)) this.chosen = decoded.success;
    }
    if (mode !== undefined) {
      const decoded = decodeMode(mode);
      if (Result.isSuccess(decoded)) this.choice = decoded.success;
    }
    this.settingsKnown = true;
  }

  private heardThemes(themes: readonly OfferedTheme[]): void {
    this.offered = themes;
    this.themesKnown = true;
  }

  private async write(key: string, value: string, undo: () => void): Promise<void> {
    const project = this.workspace.contextProject ?? this.workspace.projects[0];
    if (project === undefined) return;
    try {
      await this.door.perform('write_setting_layer', { scope: 'user', key, value }, { project: String(project.id) });
    } catch (error) {
      undo();
      this.notices.refusal(error);
    }
  }
}
