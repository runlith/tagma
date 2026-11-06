import type { OfferedTheme } from '@tagma/server/appearance/contract/wire/feeds';
import {
  modeOf,
  TAGMA_THEME,
  TAGMA_TITLE,
  THEME_MODES,
  type Theme as ThemeData,
  type ThemeMode,
} from '@tagma/server/appearance/contract/wire/format';
import { declarationsOf, paletteOf, resolve } from '@tagma/server/appearance/contract/wire/resolve';
import { type AppearanceMode, appearanceMode, appearanceTheme } from '@tagma/server/appearance/contract/wire/settings';
import type { DesktopAppearance as Bridge } from '@tagma/desktop/bridge';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { MediaQuery } from 'svelte/reactivity';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { CatalogEntry } from '$lib/features/settings/controls/catalogs.js';
import { type UserSetting, UserSettings } from '$lib/features/settings/UserSettings.svelte.js';
import { Actions } from '$lib/features/workspace/action.js';
import { DesktopAppearance } from '$lib/shared/desktop/DesktopAppearance.js';
import type { Look, ThemePort } from '$lib/shared/Theme.js';
import { Live, type LiveFailure } from '$lib/wire/Live.js';
import { actionsOf } from './actions.js';
import { type Painting, paintWith, sheetOf } from './paint.js';

const PAINT_KEY = 'appearance.paint';

type BootPaint = {
  readonly choice: AppearanceMode;
  readonly variants: { readonly [M in ThemeMode]?: { readonly declarations: string; readonly chrome: string } };
};

export type ThemeEntry = { readonly id: string; readonly title: string; readonly group: string; readonly theme: ThemeData | undefined };

export class Appearance extends Service<Appearance>()('Appearance', { tier: 'app', eager: true }) implements ThemePort {
  static *make() {
    const appearance = new Appearance(
      yield* UserSettings,
      yield* Notices,
      (yield* Platform).storage.local,
      yield* DesktopAppearance.optional(),
    );
    const scope = yield* Scope;
    const themes = (yield* Live).hold(
      (client) => client['appearance.subscribe']({}),
      (event) => appearance.heardThemes(event.themes),
      (failure) => appearance.failedThemes(failure),
    );
    scope.defer(() => themes.unsubscribe());
    scope.defer((yield* Actions).register('appearance', { id: 'appearance', area: 'Window', actions: () => actionsOf(appearance) }));
    return appearance;
  }

  offered = $state<readonly OfferedTheme[]>([]);
  look = $state<Look>({ id: TAGMA_THEME, mode: 'dark', terminal: resolve(undefined, 'dark').terminal });
  private themesProblem = $state<string | null>(null);
  private themesKnown = $state(false);
  private readonly themeChoice: UserSetting<string>;
  private readonly modeChoice: UserSetting<AppearanceMode>;
  private readonly light = new MediaQuery('prefers-color-scheme: light');
  private painted: string | null = null;
  private sheet: CSSStyleSheet | null = null;

  readonly themes = $derived.by((): readonly ThemeEntry[] => [
    { id: TAGMA_THEME, title: TAGMA_TITLE, group: 'Themes', theme: undefined },
    ...this.offered.map((offered) => ({ id: offered.id, title: offered.theme.title, group: offered.pluginTitle, theme: offered.theme })),
  ]);

  readonly entries = $derived.by((): readonly CatalogEntry[] =>
    this.themes.map((entry) => ({ value: entry.id, label: entry.title, group: entry.group, swatches: this.coloursOf(entry.theme) })),
  );

  constructor(
    settings: UserSettings,
    private readonly notices: Notices,
    private readonly storage: PlatformStorage,
    private readonly desktop: Bridge | undefined,
  ) {
    super();
    this.themeChoice = settings.of(appearanceTheme);
    this.modeChoice = settings.of(appearanceMode);
    this.look = { ...this.look, mode: this.mode };
    $effect(() => this.follow());
    $effect(() => this.paint());
  }

  get chosen(): string {
    return this.themeChoice.value;
  }

  get choice(): AppearanceMode {
    return this.modeChoice.value;
  }

  get problem(): string | null {
    return this.themesProblem ?? this.themeChoice.problem ?? this.modeChoice.problem;
  }

  get theme(): ThemeData | undefined {
    return this.themes.find((entry) => entry.id === this.chosen)?.theme;
  }

  get missing(): boolean {
    return this.chosen !== TAGMA_THEME && this.themesKnown && this.theme === undefined;
  }

  get shown(): string {
    return this.theme === undefined ? TAGMA_THEME : this.chosen;
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
    return this.themes.find((entry) => entry.id === this.chosen)?.title ?? this.chosen;
  }

  coloursOf(theme: ThemeData | undefined): readonly string[] {
    const mode = modeOf(theme, this.wanted);
    const { surfaces, text, signals } = paletteOf(theme?.[mode], mode);
    return [surfaces.background, text.foreground, signals.here, signals.failure, signals.work, signals.done, signals.waiting];
  }

  chooseTheme(id: string): void {
    void this.themeChoice.write(id);
  }

  chooseMode(mode: AppearanceMode): void {
    void this.modeChoice.write(mode);
  }

  private get wanted(): ThemeMode {
    if (this.choice !== 'system') return this.choice;
    return this.light.current ? 'light' : 'dark';
  }

  private get known(): boolean {
    return this.themeChoice.known && this.modeChoice.known && this.themesKnown;
  }

  private follow(): void {
    if (!this.known) return;
    const theme = this.theme;
    const choice = this.choice;
    this.desktop?.follow(choice === 'system' ? (this.onlyLook ?? 'system') : modeOf(theme, choice));
  }

  private paint(): void {
    if (!this.known) return;
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
    this.storage.setItem(PAINT_KEY, JSON.stringify(this.bootOf(theme, choice, shown)));
    this.look = { id, mode, terminal: shown.terminal };
  }

  private bootOf(theme: ThemeData | undefined, choice: AppearanceMode, shown: ReturnType<typeof resolve>): BootPaint {
    const variants = Object.fromEntries(
      THEME_MODES.filter((mode) => theme === undefined || theme[mode] !== undefined).map((mode) => {
        const resolved = mode === shown.mode ? shown : resolve(theme?.[mode], mode);
        return [mode, { declarations: theme === undefined ? '' : declarationsOf(resolved.tokens), chrome: resolved.chrome }];
      }),
    );
    return { choice, variants };
  }

  private heardThemes(themes: readonly OfferedTheme[]): void {
    this.offered = themes;
    this.themesKnown = true;
    this.themesProblem = null;
  }

  private failedThemes(failure: LiveFailure): void {
    this.themesProblem = failure.message;
    this.notices.fault(
      failure.kind === 'subscription' && failure.code !== undefined ? failure.code : 'appearance.subscribe',
      failure.message,
    );
  }
}
