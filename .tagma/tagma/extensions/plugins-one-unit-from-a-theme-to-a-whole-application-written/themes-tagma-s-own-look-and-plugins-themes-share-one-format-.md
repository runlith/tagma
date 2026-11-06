---
id: 01a1b124-db79-7d5f-8149-70c5ca575591
title: "Themes: Tagma's own look and plugins' themes share one format, the person picks one for every window, and state colours keep their meaning"
ord: 6
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1ad53-a8b9-7fa9-98a0-71655067fa15
  - kind: relates
    to: 01a1b123-680f-7ed0-9645-9d2cba083eb0
---
Child of [[d2b5f488]]; details its step 3 for themes. Read from the code at `eb8b0b797` on 2026-11-06. Nothing was run.

## Outcome

A person changes how Tagma looks by picking a theme and light or dark, and the choice holds in every window and on every device that reaches their Tagma. A theme comes from a plugin: one from a marketplace, or one an agent writes when the person says "make Tagma look like Nord" or "warmer background". Tagma's own look is the first theme, in the same format. Whatever theme is in force, red still means failure, blue a change or waiting on you, green done, amber work, and gold "you are here" (rule bb5ca896: the person never edits a colour by hand or reads a file).

## What a person can change

Decided for all users:
- **Theme.** Tagma's own, or any theme an enabled plugin brings.
- **Light or dark.** System, Light or Dark. A theme that comes in one look only shows that look, and the choice says so.
- **The terminal's colours.** The default becomes "Same as the theme". Picking one of the terminal's named palettes and its other settings stay as they are (feature b84c2d57).

Left out, and why:
- **No colour editor.** A custom look is a theme an agent writes on request. Its colours pass the same check as every other theme, and the person reads no values.
- **No separate code-colour theme.** Code is coloured by roles that stand off the state hues (explanation 412bbac1). A vendor code theme would put keywords back onto red and green, so syntax colours come only from the theme.
- **No fonts, sizes, radii or density in a theme.** A theme carries colours only. Metrics change every measured row (explanation 8b7128c3) and every layout, and the token rule 55b5437b fixes the sizes. Text size is the window's zoom, which is per window by design (explanation 91b1d2af). The terminal keeps its own font settings.
- **No accent choice.** Gold is the one sign of "you are here". An accent the person picks would either replace it or add a second one.

## What stands

- **`Theme`** (`app/src/lib/shared/Theme.svelte.ts`, module `app-shared`) knows `system | light | dark` in `localStorage['mode-watcher-mode']`, per browser origin. `paint()` toggles `.dark` and `color-scheme` from an effect in `app/Window.svelte`. `app.html` reads the same key before the bundle. The mode-watcher library itself is not used, only its key name.
- **Tokens.** Values sit in `app/src/app.css`, under `:root` for light and `.dark` for dark, as oklch literals. Beside the colours a theme would set, most tokens are an alias or an alpha of one: `--border` and `--hover` are the foreground's in light and white's in dark, `--severity-lie` is `--destructive`, `--status-verified` is `--status-done`, `--syntax-tag` is `--syntax-function`, and the `--chat-*` tokens map onto app tokens.
- **Code highlighting** paints `var(--syntax-<role>)` (`packages/highlight/src/theme.ts`). The editor kit styles with `var(--…)` (`packages/code-editor/src/extensions/theme.ts`).
- **Terminal.** `TerminalAppearance` (`features/executions/appearance/Settings.svelte.ts`) takes palettes by name from `TERMINAL_THEME_CATALOG` (`shared/terminalThemes.ts`). "Tagma Dark" and "Tagma Light" there hold hand-kept hex copies of `--background`, `--foreground` and `--brand` (explanation 1ec33fbf). The slot settings are `terminal.themeDark`, `terminal.themeLight` and `terminal.useSeparateLightTheme` (`executions/contract/wire/terminalAppearance.ts`). Its effect repaints on `theme.mode` only.
- **Framed views.** `ViewFrame.svelte` sends MCP Apps host context: `theme` (the mode) and `styles.variables`, the standard variable names read from computed tokens (`views/hostStyles.ts`). It re-sends `host-context-changed` when `theme.mode` or the window size changes (explanation bdc83669).
- **Graph canvas.** `GraphView.svelte` reads tokens through `getComputedStyle` on each draw.
- **Desktop.** Nothing sets `nativeTheme`, and windows set no `backgroundColor` (`desktop/src/projectWindows.ts`, `viewWindows.ts`). `app.html` hardcodes two `theme-color` metas.
- **Places that choose.** The rail menu has a Theme submenu in `app/chrome/AppMenu.svelte`. The palette has "Theme: System/Light/Dark" in `app/chrome/actions.ts`, through `PaletteActions`. The settings section `appearance` is declared in `features/shell/settings.ts`, and its server section in `settings/contract/wire/appearance.ts`.
- **Settings.** `user`-scope keys (`platform/contract/wire/setting.ts`) are the machine's layer, the same in every project's catalog. The server streams a key's value with `Settings.changes(key)` (`settings/contract/service/values.ts`). The client has no settings feed: `SettingsRepo.catalog` is a keyed query per project.
- **Plugin points** are declared by their owner with a face, checked by `contributionsRefusal` at install, on every read of an installed plugin and in the SDK build (explanations 7d2dc40e, 09039173). No theme point exists.

## The theme

A theme is data in the manifest, so it needs no process. `themes` maps a theme id to `{title, light?, dark?}`, and at least one variant is required. The theme's full id is `<plugin>.<id>`, as agents are named. Tagma's own theme is `tagma`. A variant sets only what it changes. Every unset key takes Tagma's value for that variant's mode, so a theme stays small and keeps working when Tagma adds a token.

**Keys a variant sets**, by meaning rather than by CSS name, so an author reads what each one is for:

| Group | Keys | Tokens they set |
|---|---|---|
| `surfaces` | `chrome`, `background`, `field`, `raised`, `popover`, `sunken`, `muted`, `accent` | the same names |
| `text` | `foreground`, `muted`, `primary` | `--foreground`, `--muted-foreground`, `--primary` |
| `signals` | `failure`, `stale`, `work`, `here`, `done`, `waiting`, `change`, `neutral` | `--destructive`, `--status-stale`, `--status-in-work`, `--brand`, `--status-done`, `--status-open`, `--mutation`, `--status-none` |
| `syntax` | `text`, `declaration`, `property`, `punctuation`, `operator`, `comment`, `keyword`, `string`, `function`, `type`, `constant` | `--syntax-<key>` |
| `marks` | `project` (8), `worktree` (6) | `--project-1…8`, `--worktree-0…5` |
| `terminal` | the 16 ANSI colours, keyed as `TERMINAL_COLOR_GROUPS` names them | the terminal palette |

- **Colours** are opaque `#rrggbb` or `oklch(L C H)`. Translucency is Tagma's to derive.
- **Derived values** are computed by Tagma from the keys, exactly as `app.css` writes them today:
  - aliases: `--popover-foreground`, `--accent-foreground`, `--primary-foreground`, `--severity-*`, `--status-verified`, `--status-closed`, `--status-superseded`, `--syntax-background`, `--syntax-tag`, `--syntax-attribute`, `--syntax-inserted`, `--syntax-deleted`, `--syntax-changed` and the `--chat-*` map;
  - alphas: `--border`, `--input`, `--hover`, `--selected`, `--vein*`, `--ring`, `--hover-danger`, `--brand-soft` and `--elevation-*`;
  - the terminal's background, text, cursor and selection: the variant's `background`, `foreground` and `here`, so the terminal never stands out from the thread (feature b84c2d57).
- **Fixed at Tagma's values:** the web window buttons, the QR and pointer inks, the scrims, the `--tag-*`, `--speaker-*` and `--hand-*` hues, and all sizes, spacing, radii and fonts. Opening tags, speakers and hands later is pure addition.

**One resolution function** (`resolve(theme, mode)` in `appearance/contract/wire/`) turns a variant into values: base, keys, derivations, and hex for the terminal. Its callers are the generator of Tagma's own stylesheet, the meaning check, and the window. No second copy of the derivations exists (rule 51c66cb6). Colour parsing, oklch→sRGB with gamut mapping, and WCAG contrast come from `culori`'s functional entry, inside one `colour.ts` beside it. The terminal's own parser and luminance in `executions/terminal/engineOptions.ts` move onto that module (rule dd380bf6).

## State colours keep their meaning

The `themes` face's schema carries a filter. It judges every resolved variant, Tagma's base included, and refuses with the key, the value and what to change, for example: "`signals.failure` #a3be8c reads as done: its hue 129° is outside failure's 322°–31°". The criteria:
1. **Each signal stays in its family's hue window (OKLCH).** Each window runs halfway to the neighbouring family's hue in Tagma's own theme:

   | Family | Window |
   |---|---|
   | failure | 322°–31° |
   | stale | 31°–55° |
   | work | 55°–78° |
   | here | 78°–120° |
   | done | 120°–202° |
   | waiting and change, both blue | 202°–322° |

   Each signal but `neutral` has a chroma of at least 0.08. `neutral` has at most 0.03.
2. **Signals of different families stand at least 15° apart.** Tagma's tightest pair, work and here, is 20°.
3. **Contrast.** Every signal reaches 3:1 against `background`, `chrome`, `raised` and `popover` (WCAG 1.4.11). `text.foreground` and `text.muted` reach 4.5:1 against every surface (WCAG 1.4.3).
4. **Syntax.** Any syntax role with a chroma of 0.03 or more stands at least 21° from every signal hue. Its chroma stays below the lowest chroma among failure, work, done, waiting and change (explanation 412bbac1).
5. **Marks.** Every project and worktree mark has a chroma of at most 0.08. A mark with a chroma of 0.03 or more stands at least 21° from every signal hue (explanations f0e82349, 646a9782).
6. **Surfaces and text.** Their chroma stays at most half the variant's lowest signal chroma, so a tinted theme such as Nord or Solarized stays, and nothing but a signal reads as one. Tagma's own neutral dark (explanation f671eb5f) is Tagma's choice, not a rule on other themes.

The windows leave room for a theme safe for colour-blind people: done can move toward teal, and failure toward crimson. The filter is the face's own code, so the SDK build gives the author the same reason the install gives (explanation 09039173).

**After an update.** A Tagma update can move a base value and make an installed theme fail. That plugin then reads broken with the reason, and Fix with an agent retunes it ([[5067fa15]], Versions).

**Tagma's own theme passes too.** Today `--project-5` (235°) stands 17° from `--mutation` (252°), against the 21° explanation f0e82349 records. It moves to 230° in the same change.

## Tagma's own theme

Tagma's look becomes data: `appearance/contract/wire/tagma.ts` holds both variants, every key in oklch, with the ANSI colours of today's Tagma terminal palettes.
- **Generated stylesheet.** A generator writes `app/src/tokens.generated.css`, with `:root` for light and `.dark` for dark, every source, derived and fixed token. It runs through `resolve`, as `packages/tagma/kit/generated.ts` writes its files, and an itest fails while the file is stale. `app.css` imports it and keeps only `@theme inline`, the utilities and the base layer.
- **No hand copy.** "Tagma Dark" and "Tagma Light" leave `TERMINAL_THEME_CATALOG`, and their hex is computed from the same oklch, so the copy explanation 1ec33fbf guards against drift no longer exists.
- **The stands** (`packages/chat-ui/stand/tokens.css`, `packages/code-editor/stand/tokens.css`) are left as they are.

## The person's choice

- **Two `user`-scope keys**, declared by `appearance`, in the existing `appearance` section:
  - `appearance.theme`: a theme id, default `tagma`;
  - `appearance.mode`: `system | light | dark`, default `system`.

  They are written by the settings doors that exist: the screen through `write_setting_layer {scope: 'user'}`, an agent through `write_setting`. "Make Tagma look like Nord" is therefore a plugin install plus one setting, with no new operation. The section's declaration moves with the keys, from `settings/contract/wire/appearance.ts` and `features/shell/settings.ts` to `appearance` and `app-appearance`, and its description names the theme.
- **Resolving the mode.** A theme with one variant shows that variant. Otherwise `appearance.mode`, with `system` read from the device's `prefers-color-scheme`. Every device therefore follows its own system while the person's choice is one.
- **A theme no longer offered.** Removed, off everywhere, or broken: the window paints Tagma in the resolved mode. The Theme row says the chosen theme is not installed, with **Use Tagma** in place, and the setting stays, so turning the plugin back on restores it (rule ea465bed: the loss is shown, not hidden).
- **When a theme is offered.** While its plugin is on in any project or for all my projects — the publication rule of explanation 7d2dc40e. **Use** on a theme turns its plugin on for all my projects, when it is on nowhere, and sets `appearance.theme`, as one act. "Off here" leaves the theme while the plugin stays on elsewhere.
- **Storage moves** from the browser to the server. The old `mode-watcher-mode` key is dropped (rule 0528876d): the first start after the change paints the system mode until the feed answers.

## How a theme reaches each place

**Two feeds**, so every window and device hears a change as it lands, with no polling. Both have callers `operator` and no project admission, so they are the same on the local and the remote door, and the client adds them to `USED` in `lib/wire/liveGroup.ts`:
- **`settings.watch {keys}`**, owned by `settings`, for any setting that belongs to the person. The keymaps spec reads `shortcuts.bindings` from the same feed.
  - **It answers** only keys whose sole settable scope is `user`. Any other key refuses `setting-scope`, since its value depends on a project; an unknown id refuses `unknown-setting`.
  - **Its events.** The first carries the effective value of every named key: the user layer over the default. Each later one carries the changed keys' values, fed by the existing `SettingChanges` port (`settings/contract/service/changes.ts`).
  - **Its readers.** Each reader holds its own subscription through `Live`, which shares the socket, and decodes each value with the key's own schema from the wire that declares it.
- **`appearance.subscribe`**, owned by `appearance`, for the catalog alone. Each event carries every offered theme as written, with its plugin and title. It is re-sent on a publication or a withdrawal.

**The window.** `Appearance` (`features/appearance`, the new client module `app-appearance`, tier `app`) holds both feeds through `Live`: `settings.watch` over `appearance.theme` and `appearance.mode`, and `appearance.subscribe`. Its catalog is `tagma`, compiled in from the wire, followed by the offered themes. One effect resolves the theme and mode, and when the resolved theme differs from the last one:
1. writes the variant into one constructed stylesheet in `document.adoptedStyleSheets`, `:root{…}` (`replaceSync`; empty for `tagma`, since the generated sheet already holds it). Adopted sheets cascade after document sheets, so `:root` overrides both `:root` and `.dark` of the generated sheet;
2. toggles `.dark` and `color-scheme`, which Tailwind's `dark:` variants still need, and keeps today's paint without transitions;
3. sets the `theme-color` meta to the variant's `chrome`, for the phone's status bar;
4. writes the boot cache;
5. publishes `look` last.

Every reader's effect therefore runs after the paint, which removes the ordering hazard explanation 1ec33fbf names. A choice made in this window applies at once and converges to the feed's value, so two windows never trade writes.

**Readers.** `Theme` in `lib/shared` becomes a port of shape `{mode, look}`, filled by `Appearance` in `runtime.ts`. `look` is `{id, mode, terminal}`, the resolved variant with its terminal palette as hex. Many features read the theme, and `app-shared` holds no domain (its card), so the port keeps their imports where they are (rule e090f46d).

**First paint.** `Appearance` writes `Platform.storage.local['appearance.paint']`: the chosen mode, the resolved CSS of each variant the theme has, and its chrome colour. Only the inline script in `app.html` reads it: it picks the mode as today and injects the CSS before the bundle. The cache is the window's own last paint; nothing else reads it or watches it.

**Desktop.** A bridge port `DesktopAppearance` (`lib/shared/desktop/`, desktop only, taken with `optional()`) sets `nativeTheme.themeSource` to `system` for a two-variant theme on System, and to the resolved mode otherwise. Every window sends the same value, so they converge. Native dialogs and the window frame on Windows and Linux follow, and so does `prefers-color-scheme` in every page Electron shows.

**Terminal.** `terminal.themeDark` and `terminal.themeLight` default to `theme` ("Same as the theme"), the first entry of the terminal catalog. `TerminalAppearance` resolves it to `look.terminal`, and repaints on `look` rather than on `mode`. The separate-light switch keeps its meaning.

**Code.** Highlighting and the editor need nothing: they read `--syntax-*` and the other tokens, and CSS switches them.

**Graph canvas.** Its draw effect depends on `Theme.look`, so a theme change in the same mode redraws.

**Plugin views now** — HTML framed on the plugin's origin, and MCP App windows. `ViewFrame`'s effect depends on `Theme.look`, not `mode`, so every theme change re-sends `host-context-changed` with `theme` and the standard `styles.variables`. Those MCP Apps names are the contract a framed page reads. Tagma adds no variables of its own there.

**Svelte views in step 5.** They mount into the window's document, so they read the same variables and switch with the same sheet. No second mechanism exists: the framed path is the MCP Apps projection that MCP App windows keep anyway.
- **What a view reads.** The window's token utilities and the components of `@runlith/tagma/ui`. `useTagma().theme` answers `{id, mode}` reactively, for a view that draws on a canvas.
- **What a view must not use.** Default Tailwind colours, whose values no theme changes. The SDK build refuses them by the same judgement as rule 55b5437b applies to the window, so every theme reaches every plugin view.

**Not themed.** Pages agents write and someone else's site in `<Frame>` keep their own design. On desktop their `prefers-color-scheme` follows the person's resolved mode through `nativeTheme`; in a browser tab, the device.

## Interface

Following the design skill, the person meets the theme in four places:
- **The rail menu.** The Theme submenu leaves `AppMenu.svelte` and becomes a `MenuParts` row of `app-appearance` (note 5c4b5666). It lists the themes as a radio, the current one with the gold check, then a separator and System, Light and Dark. For a one-variant theme, one `Note` line takes the mode's place: "Nord comes only in dark".
- **The palette.** Each offered theme is an entry `app-appearance` contributes to `Actions`, the palette and keymap point of [[ba083eb0]] (today `PaletteActions` in `features/workspace/action.ts`). The entries read "Theme: Nord", and "Appearance: Light", "Appearance: Dark" and "Appearance: Same as the system". The theme entries leave `app/chrome/actions.ts`. A chord for any of them is the person's to bind there.
- **Settings → Appearance.** The section moves to `app-appearance`.
  - The Theme row uses the existing catalog control with swatches: background, text, here, failure, work, done and waiting of the current mode. Its choices come from a `ChoiceSets` point that each owner fills. Today `features/settings/controls/catalogs.ts` holds the terminal set as a constant and models through `ModelChoices`; `SETTING_CHOICE_SETS` gains `theme`.
  - A Light-or-dark row, a choice of words.
  - **Find themes** opens the Plugins screen's marketplace search. **Make a theme with an agent** opens a thread through the same act as Fix with an agent, with the request started for the person to finish.
- **The plugin card.** The words for themes are this spec's: each theme the plugin brings, by title, with **Use** in place, and "In use" on the current one. A theme that fails the check reads broken, with Fix with an agent ([[d2b5f488]], The Plugins screen).

## Authoring

- **The SDK field.** `themes` in `definePlugin` ([[5067fa15]]) is typed from the point's schema, through the kit. Each key carries its meaning as its description, so an agent writes a theme from the types: `themes: { nord: { title: 'Nord', dark: { surfaces: { background: '#2e3440' }, signals: { here: '#ebcb8b' } } } }`. A plugin made only of themes runs no process.
- **The `plugins` skill** (rule 7cb3c1cf) gains the theme: the groups, the check, and setting `appearance.theme` after installing.
- **Where a person's theme lives.** A theme the person asks for is theirs, not the project's, so it goes among the person's own plugins (`<data>/plugins/<id>/`, [[d2b5f488]]). `create_plugin` must take that place as well as `.tagma-plugins/<id>/`. A project may still ship a theme for its team.
- **VS Code themes are not read.** Their token colours sit on the state hues and would fail the check. An agent ports one on request, retuning what the check names.

## Modules and data flow

- **`appearance` (server, product, new)** owns how Tagma looks:
  - the theme format;
  - Tagma's own theme;
  - `resolve` and `colour.ts`;
  - the meaning filter;
  - the `THEMES` point and its face (title "Themes for how Tagma looks"), bound through `PluginPoints.declare` with a `register` that only adds to its catalog and returns the disposer;
  - the two keys and the `appearance` section;
  - the `appearance.subscribe` feed.

  It imports `plugins` (the point registry), `settings` (key declarations), and `executions`' wire for the ANSI slot names. It changes when the person's choices about the look, or the token vocabulary, change. `views` keeps the window points that host plugin UI. Themes are not hosted UI, and Tagma's own look is no plugin view.
- **`settings` (server)** gains `settings.watch`, the one live read of the person's settings, shared with [[ba083eb0]].
- **`app-appearance` (client, product, new)** owns the window's look:
  - `Appearance`, which fills `Theme`;
  - the boot cache;
  - the menu row, the palette entries, the Appearance section and the `theme` choice set.

  It imports `app-shared`, the wire, settings and the keymap's `Actions`.
- **`app-shared`** keeps `Theme` as a port only.
- **Unchanged:** `executions` beyond the `theme` value, `views` beyond reading `look`, `plugins` and `plugin-host`.
- **The kit** regenerates: the `themes` field type, and the filter inside `checks.generated.js`.

```
plugin enabled → plugin-host publishes → THEMES.register → appearance catalog → appearance.subscribe ─┐
write_setting(_layer) appearance.* → settings store → SettingChanges → settings.watch ───────────────┴→
  each window: Appearance → resolve → adopted sheet, .dark, meta, boot cache, nativeTheme → Theme.look
  → terminal palette · framed views' host context · graph redraw · (step 5) views read the variables
```

## Cost on every machine

- **A switch** costs one style recalculation of the document, the same as today's `.dark` toggle, plus one xterm `setTheme` per open pane. The pane side is already deduplicated by `themesEqual`.
- **Resolving** is about a hundred colour conversions.
- **The filter** runs a few hundred contrast and hue comparisons, bounded by the fixed key set, at build, install and read.
- **The feed** is one subscription per window. An event is a few kilobytes per theme, sent only when something changes.

Nothing grows with projects, threads or repository size.

## Order of work within step 3

1. **`appearance` on the server:** the format, Tagma's own theme as data, `resolve`, `colour.ts`, the filter, the point, the keys and `appearance.subscribe`. `settings.watch`, shared with [[ba083eb0]], is built by whichever lands first. Regenerate the kit.
2. **The generated stylesheet:** it replaces `app.css`'s values and the terminal's Tagma palettes, and `--project-5` is retuned.
3. **`Appearance`, the `Theme` port and the readers:** the boot cache, `app.html`, `DesktopAppearance`, the terminal's `theme` value, `ViewFrame` and the graph on `look`.
4. **The interface:** the menu row, the palette entries, the Appearance section with `ChoiceSets`, and the card's words with **Use**.
5. **Text:** the skill and the blocks below.

## Acceptance

Performer checks, each through its real caller's door:
- **Tagma passes.** Tagma's own theme passes the filter in both modes, and `tokens.generated.css` is current, by an itest in the kit's style.
- **A swapped colour fails to build.** A plugin whose `signals.failure` is green fails `tagma-plugin build` with the reason naming the key, the value and failure's window. `install_plugin` refuses the same manifest with `plugin-refused` and the same reason.
- **Choosing.** A theme plugin installed from a folder appears in `appearance.subscribe`. `write_setting appearance.theme` makes two mounted windows (`mountShell`, both on the real `Appearance`) publish the new `look`. The terminal's "Same as the theme" palette equals the theme's terminal palette. A framed view receives `host-context-changed` with the new `styles.variables` while the mode stays the same.
- **One variant.** With a dark-only theme and mode Light, the window paints dark, the menu shows the Note, and `DesktopAppearance` receives `dark`.
- **Withdrawn.** Removing the theme's plugin paints Tagma, the Theme row reads not installed with Use Tagma, and `appearance.theme` keeps its value. Reinstalling paints the theme again.
- **First paint.** A headless e2e with `appearance.paint` seeded paints the theme's background in the first frame, before the bundle runs.
- **The person asks in words.** In a test world, "make Tagma look like Nord" leads an agent to write a theme plugin, build it, install it and set `appearance.theme`. The window shows it, and the person types no command.

## Text that follows

These are rewritten when the code lands:
- the `tagma-design` skill (where values live) and the `plugins` skill;
- feature 1727a3f5, which today names `mode-watcher` and says that returning to System clears the choice, while the code writes `system` through Tagma's own `Theme` and paints from `Window.svelte`;
- feature b84c2d57;
- explanations 1ec33fbf (retired), f671eb5f (Tagma's own theme), 412bbac1 and f0e82349 (values now in `tagma.ts`, checked by the filter), and bdc83669 (re-sent on `look`);
- the cards of `app-shared` and `app-routes`.

## Open for the operator

Product questions:
- **The theme follows the person.** It becomes one choice for every window and device that reaches their Tagma, while each device still follows its own system on System. Until now it was kept per browser (feature 1727a3f5, Limits). The reason is that agents can then set it and every window agrees. Is the device-local behaviour given up?
- **Looks of Tagma's own.** Should Tagma ship more than its default — a high-contrast theme and one safe for colour-blind people — as built-in themes, or should every other look come from plugins?
- **Fonts.** Does Geist stay Tagma's only type, or may a person choose the interface and code fonts?

## Not established

Reasoned from documentation or the code, not run:
- that `nativeTheme.themeSource` sets `prefers-color-scheme` inside framed pages in every window;
- whether a browser tab gives an iframe the embedding element's `color-scheme`;
- that an adopted sheet cascades after Vite's injected CSS in the dev front with HMR, which is reasoned from the cascade's order of adopted sheets.

Not computed or measured:
- that Tagma's own theme meets the contrast thresholds, which are estimated from oklch lightness;
- that 15° between signal families and the hue windows read apart at every lightness, and for colour-blind themes;
- the cost of a whole-document recalculation on the weakest machine Tagma serves.

Other unknowns:
- whether the kit's expansion carries the face's filter unchanged, which [[5067fa15]] also leaves open;
- whether the Fix with an agent act can open a thread with a started request for the person to finish.
