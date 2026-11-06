---
id: 01a1b123-680f-7ed0-9645-9d2cba083eb0
title: "One keymap over every action: Tagma's, plugins' and the person's own keys, local and global, with conflicts shown and rebinding in place"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a640beeb16
  - kind: relates
    to: 01a1705d-f50f-7de3-835c-49ab9735af57
  - kind: relates
    to: 01a174c2-6fdc-7705-9ee5-5d7885824838
  - kind: relates
    to: 01a174f2-3d44-7a14-9cbf-a66c23e74cc4
  - kind: relates
    to: 01a1ad53-a8b9-7fa9-98a0-71655067fa15
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/keys/Keymap.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Keymap.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/action.ts
  - kind: file
    ref: apps/tagma/server/src/views/contract/wire/points.ts
  - kind: file
    ref: apps/tagma/desktop/src/interception.ts
  - kind: file
    ref: packages/desktop-host/src/GlobalShortcuts.ts
  - kind: file
    ref: apps/tagma/server/src/speech/keys.ts
---
Child of [[d2b5f488]], detailing its step 3 for shortcuts and actions. Read from the code at `59387b178` on 2026-11-06; nothing was run. Window entries a plugin declares are a later step of [[d2b5f488]] and stay out of this spec: a shortcut here opens a place that already exists — a section or a pane — or runs an action.

## Outcome

A person presses a key and something he can name happens, wherever the key came from: Tagma, a plugin, or himself. One screen lists every key, says what each one does and what took a key from whom, and changes any of them in one act. Nothing is lost silently: a key that cannot work says why on its row and on its plugin's card, with **Rebind** in place. A key marked global works in every app on the machine while Tagma runs. A plugin's key works in every app only once the person allows it with one click on the plugin's card; until then it works inside Tagma.

The person never types a chord in text and never reads a keymap file: he presses the chord he wants.

## Decided with the operator on 2026-11-06

A plugin's global shortcut is off until the person turns it on with one click on the plugin's card; its local shortcuts work as soon as the plugin is enabled. A global chord takes its keys from every app on the machine, and a person who never reads code would not tie a chord that broke in another app to a Tagma plugin.

## What stands

Seven key mechanisms, none of which knows the others:
- **The window's `Keymap`** (`app/src/lib/app/keys/Keymap.svelte.ts`) keeps bindings `{chord, run, framed?}` in one list. `press` walks it from the last bound, and the first `run` answering true wins, so the last binder wins and nothing records a conflict. It matches `event.code` exactly (`sameChord`). It publishes every bound chord to the desktop (`DesktopBrowser.keys`), which forwards them from built-in browser pages (`desktop/src/browser/host.ts`, `key`) and, for bindings declaring `framed`, from child frames (`browser/framedKeys.ts`, explanation [[9735af57]]).
- **The terminal's table** (`features/executions/terminal/Keymap.ts`, `CHORD_TABLE`) has per-OS chords with a `tab` variant for the browser, its own grammar (`parseChord`, `Mod+Shift+D`), its own layout-aware matcher (`matchChord`: the logical key first, the physical code for dead, composed and non-Latin keys) and the `terminal.shortcutPolicy` setting. Two of its acts are bound into `Keymap` from it (`terminal/Panel.svelte`).
- **Dictation's key** has a third grammar and matcher (`features/speech/dictation/chord.ts`, `Meta+KeyK` by code), its own capture-phase listener (`dictation/Keys.svelte`), its own "press the new chord" control (`speech/VoiceInput.svelte`), and three settings: `speech.dictation.key`, `speech.dictation.global` and `speech.dictation.globalKey` (`server/src/speech/keys.ts`). Its global hold goes through the `desktop-input` helper (`desktop/src/Dictation.ts`).
- **The shell fixes chords in code.**
  - Quick hide, `CommandOrControl+Shift+L` over Electron's `globalShortcut` (`desktop/src/projectWindows.ts`, `packages/desktop-host/src/QuickHideShortcut.ts`), which only logs a chord it could not take.
  - ⌘W and ⌘⇧T (`desktop/src/tabKeys.ts`), sent to the window as tab commands that `DesktopTabKeys.svelte` turns back into chord presses on `Keymap` (explanation [[85824838]]).
  - ⌘N and the devtools chords (`projectWindows.ts`), and the menu roles (`quitting.ts`).
- **Palette actions** are a point (`PaletteActions`, `features/workspace/action.ts`) that carries no chord. Keys are bound apart from them, so one act is written twice: ⌘\ toggles the column in `app/chrome/Shell.svelte`, and the `column.toggle` action does the same in `app/chrome/actions.ts`.
- **About two dozen places spell a chord by hand** for a tooltip, a menu tail or a hint (`TopBar.svelte` `keymap.mod('KeyK')`, `NavigationRail.svelte`, `AppMenu.svelte`, `FileTab.svelte`…). Each of them would lie once the key changed.
- **Plugins** have no shortcut or action point (`views/contract/wire/points.ts` holds views, results, surfaces, panes and launchers).

Four chord types stand for one thing: the bridge's `Chord`, dictation's `Chord`, the terminal's `ParsedChord`, and the bridge's `HeldKey`.

## Decisions

### An action is what a key runs

Every key that does something a person can name runs an action by its id; no key runs code of its own.
- **The point.** `PaletteActions` becomes `Actions` (`Action` per entry). Each feature still declares its entries in its own layer. An entry gains:
  - `keys`: its default chords as text, with a browser variant where the browser keeps the desktop chord, as the terminal table's `tab` rows do now;
  - `region`: the one region it acts in, for the terminal's acts;
  - `hold`: it acts from press to release, for dictation;
  - `by`: Tagma, or a plugin with its rank.

  An action bound to a region is not listed in the palette.
- **Handlers.** A place that serves an action differently by focus registers a handler for it: `Keymap.handle(id, run)`, latest first, a handler declining with false. The action's own `run` comes last. The palette runs the same chain. So the ⌘W chain of [[85824838]] is the `tab.close` action, with handlers from the browser page, the terminal pane and the file tabs. `DesktopTabKeys` stops pressing chords, and ⌘\ is the one `column.toggle` action.
- **Not actions.** Keys that type, move a caret or a selection, or confirm or dismiss the focused widget stay with their widget: Enter, arrows, Escape closing a popover, Tab in the palette, the code editor's own keys, and the terminal's byte encodings (⌘← as `^A`, Shift+Enter as CSI). The project strip's ⌃` recents switcher stays the strip's own gesture too: it is caught by key position (`Backquote`, `IntlBackslash`), which the logical-first matcher would lose on the Russian layout and ISO keyboards, and it ends on ⌃'s release.

### One table, four layers

The effective table comes from one pure function, `resolveKeys`, over four layers, highest first:
1. **The shell.** These are chords the host keeps for itself, and nobody binds them.
   - On desktop: the menu roles the page never sees (quit, hide, edit, zoom, fullscreen) and the shell's own new window and devtools chords.
   - In a browser tab: the chords the browser keeps (⌘T, ⌘W, ⌘N, ⌘Q…).

   The layer is a port, `ShellKeys`, that `app-keys` declares and composition fills per host (rule 6f758080). The desktop's list is declared by main, beside the menu it builds, and read through the bridge.
2. **The person**: `shortcuts.bindings`.
3. **Tagma**: the defaults of Tagma's actions.
4. **Plugins**: their proposed chords, plugin by plugin, in the order of the machine's `plugins.installed` list. This layer yields window chords only: a chord a plugin asks to have in every app becomes global through the person's layer, once he allows it.

**Holding and displacing.** A chord taken in a layer is held there. The same chord proposed lower, in the same place, is displaced: it is left unbound and reported with its holder. A place is the window or one region; a global chord shares every place, because the OS catches it before any window.

**Shadowing.** A region's binding shadows a window binding on the same chord while focus is inside the region: ⌘K clears a terminal and opens Find or ask elsewhere. That is the design. The screen shows it, and it is never a conflict.

**Who wins:**
- **The person wins.** When he takes a chord another action holds, the capture asks first. His layer then records the move: the chord is added to his action and removed from the other. His layer therefore never holds a conflict of its own, and a new Tagma default landing on his chord is displaced.
- **Tagma's defaults beat plugins,** as [[d2b5f488]] says.
- **Between plugins, the earlier installed keeps the chord,** so a newcomer never takes a chord from a plugin that already holds it. This needs a stable order. An update must write the plugin in place in `plugins.installed` (`plugins/installs.ts`, `put` → `recorded`). Today the update removes it and appends it, which would make every update the newest plugin.

**Per window.** Each window resolves the table from its own `Host`, OS and kind. `Mod` means ⌘ on macOS and Ctrl elsewhere. One person's bindings therefore serve a desktop window, and a browser tab on another OS through the remote door. The capture writes `Mod` for the platform's primary modifier, so a binding carries across OSes.

### One chord grammar and one matcher

`server/src/platform/contract/wire/chord.ts` holds:
- the text form: `Mod`, `Cmd`, `Ctrl`, `Alt`, `Shift`, and a key named apart from any layout — `A`–`Z`, `0`–`9`, `Space`, `Enter`, `F1`…, `Backslash`, `BracketLeft`, the names the terminal table uses now;
- its Schema;
- the parse into the one `Chord`;
- the matcher of a key press.

**The matcher is the terminal's.** It is the most complete of the three, and its layout cases move with it.

**Who uses it:** the server's schemas (the setting and the plugin face), the window's keymap, the terminal, and the desktop shell's interception. One press is therefore judged the same way everywhere. `platform` is the lowest floor that server, window and desktop all import (rule 144dfedc); `@tagma/desktop` already depends on `@tagma/server`.

**What goes:** the bridge's `Chord` and `HeldKey`, dictation's `Chord`, and the terminal's `ParsedChord` and `parseChord`. Spelling a chord as signs (⌘K) stays in `shared/chordSpelling.ts`.

### Where the person's keys are kept

- **The setting.** `shortcuts.bindings` is a `user`-scope setting with merge `replace`. It is declared beside `appearance` in `settings/contract/wire`, where window settings that no server module owns already stand (`appearance.loadInStatusBar`). Section: `shortcuts`, titled "Shortcuts", because "Keys" would read as API keys beside Secrets.
- **The value.** A map from an action id to the person's chords for it, each `{keys, global?}`.
  - An action listed with no chord means he removed its keys.
  - An unlisted action keeps its defaults.
  - Entries for a removed plugin's actions stay, and apply again if the plugin returns.
- **A plugin's global is kept as the person's own binding.**
  - **Work in every app**, on the plugin's card or the action's row, writes his entry for the action: the plugin's chords, with `global` on the one it asked for. No second key records the grant: the row menu's **Work in every app** already writes this choice for any action, and a separate list would hold it twice.
  - The entry carries the chord, so a plugin update that asks for another chord never goes global unasked: the action keeps the chord he allowed.
  - **Only in Tagma** clears `global`, and an entry left equal to the action's defaults is dropped.
  - Allowing a global follows the capture's rule for a taken chord. A global shares every place, so when it would take a chord another action holds anywhere (a terminal's, say), the line asks first, with **Use here** and **Cancel**.
  - The grant stays with his entries, so a plugin he removes and brings back keeps it.
- **Writing and reading.** It is written through `write_setting_layer` with `scope: user`, like every other settings write. Every window learns of a change through `settings.watch {keys}`, a feed of `settings` that the themes spec [[ca575591]] defines and this one shares: the effective values of keys whose only settable scope is `user`, then one event per change, fed by the existing `SettingChanges` port (`settings/contract/service/changes.ts`). The shortcuts feature holds its own subscription through `Live` and decodes `shortcuts.bindings` with the key's own schema. The catalog read (`SettingsRepo.catalog`) is a plain query and is not live.
- **Dictation's settings go.** `speech.dictation.key`, `speech.dictation.global` and `speech.dictation.globalKey` are removed (rule 0528876d). Dictation is the `dictation.hold` action, and its window key and global key are the person's bindings like any other.

### Global shortcuts are the shell's grant

A binding marked global is registered by the shell, never by its owner.
- **Publishing.** The window publishes the global part of its table through the bridge.
- **Registering.** Main registers tap globals with `globalShortcut`, and hold globals (dictation) with the `desktop-input` helper it already runs. For each chord it answers one of: held, taken by another app, or needs Accessibility. The row shows that answer.
- **A press:**
  - an action main owns, "Hide and show Tagma" (today's quick hide), runs in main;
  - any other action goes to the last focused project window, which is revealed first;
  - with no window open, main opens one and delivers the action once that window stands on the surface.
- **Which set.** Every window computes the same set, and main takes the newest publication. Main keeps the last set when windows close, so a global works while Tagma runs with no window.
- **The registrar.** `QuickHideShortcut` gives way to one registrar in `desktop-host`, `GlobalShortcuts`, which registers a set and reports refusals instead of logging them.
- **Plugins** never touch Electron. They propose, the person allows a global, the table decides, and the shell registers. A plugin's chord the person has not allowed in every app is never in the global set the window publishes.
- **On the web** there is no global. A global binding acts while the tab is focused, and the row says so.
- **Limits.** A region action is never global, and a plugin's actions never act in a region.

### Which keys win inside a window

**Bubble phase.** `Keymap` keeps listening in the bubble phase (`listen`). A focused widget therefore handles its own keys first, and what it consumes (`defaultPrevented`) never reaches the table.

**The terminal** stays the judge of its region:
- Its input path (`terminal/Input.ts`, `handleKey`) asks the table which terminal action a press is, `Keymap.actionAt(press, 'terminal')`, instead of reading its own `CHORD_TABLE`.
- Its acts become `Actions` with `region: 'terminal'` and that table's defaults.
- `TerminalKeymap` keeps the byte encodings and `terminal.shortcutPolicy`: terminal-first passes window chords to the program.

**Hold actions** are dispatched in the capture phase, because a dictation key held over a field must never type into it (`dictation/Keys.svelte` does this now). IME composition is skipped, as it is now.

**The desktop's interception:**
- It intercepts in `before-input-event` every published chord that its own menu also holds (⌘W against Close Window, ⌘⇧T), so the page's action is reached first. This replaces the fixed chords of `tabKeys.ts` and the tab command channel (`DesktopTabs.onCommand`).
- A window action with a modifier is intercepted while focus is in a frame Tagma serves: a plugin view on its plugin's origin, the views feed's `site.origin`. ⌘K therefore opens Find or ask from inside a plugin section.
- Bare keys and Shift-only keys stay with the frame. A frame of someone else's page keeps every key not declared `framed` for it, as explanation [[9735af57]] says.

**Step 5** compiles plugin views into the window and removes their frames. The served-frame rule then has nothing left to cover, and `<Frame>` content keeps its keys like any foreign page. No second mechanism is needed. In a browser tab, until then, a key pressed inside a plugin view's frame stays in the frame, since no shell exists to intercept it.

### Plugins: actions and shortcuts

`views` owns the faces of the window's points ([[d2b5f488]]) and gains two.

**`actions`**: `[{id, title, tool}]`, face title "Actions you run from the palette or a shortcut".
- `calls` names its tools, which `plugin-host`'s `tools` face answers for, with audience `tagma`.
- In the SDK it is a handled point, like `schedules` (`packages/tagma/src/plugin/describe.ts`, `tagmaTool`): `actions: { sync: action({ title: 'Sync boards', run: async (ctx) => … }) }`.
- A handler may answer one sentence for the person, which the window shows as a notice. A throw shows as a refusal notice, so a key never fails in silence.

**`shortcuts`**: `[{keys, action, global?}]`, face title "Shortcuts".
- `action` names one of its `actions`, `section:<view>` of its `surfaces`, or `pane:<view>` of its `panes`.
- `global` asks for every app. It is a request: the chord works inside Tagma until the person allows it.
- `refuses` an unknown name and a chord listed twice in the plugin; the platform schema checks the chord.
- A chord is no claim. Claims refuse a plugin's whole publication (`plugins/points.ts`), and a proposal is never a reason to refuse a plugin.

**The feed `views.actions`** is machine-wide, for the operator. It lists every published plugin in `plugins.installed` order, with:
- the projects that enable it (`HostedPlugins.roots`);
- its actions: its own, and the open-section and open-pane acts of its sections and panes, with their titles;
- each action's proposed chords, those asked for every app marked.

It is one feed, because shortcuts belong to the person in every window (the scope table of [[d2b5f488]]).

**The operation `run_plugin_action {plugin, action}`** is an operator call placed in the project it runs in, with an `external` effect.
- It is admitted inside the generation that runs it, like `call_plugin_tool` (`PluginHost.callAdmitted`).
- The process receives the caller `operator {projectId}`.
- It is a demand, so it wakes an idle process.

**In the window.**
- `plugin-views`' app-tier `PluginActions` subscribes the feed. It contributes each plugin action to `Actions`, with the proposed chords as its `keys` and `by: {plugin, rank}`.
- The palette lists an action only where the context project enables its plugin.
- Opening a section or a pane goes through `ShellOps`, as `sectionActions` does today. This derivation replaces `sectionActions`, leaving one derivation of a plugin's acts (rule 51c66cb6).

**Where a press acts.**
- In the context project, when it enables the plugin.
- Otherwise in the first project of the person's project list that enables it. That order is his own, and the window records no recency across projects (`Visits` keeps one place per project, not an order).

A press answers at once (rule c57e2aa9), so it asks nothing.

**Scope**, as in [[d2b5f488]]'s table:
- "Off here" changes nothing: the chord stays held, and a press goes to a project that enables the plugin.
- "Off everywhere" and removal withdraw the plugin's shortcuts.
- Actions in the palette follow the projects that enable the plugin.

**SDK.** The `actions` and `shortcuts` fields come from the generated points (`points.generated.ts`), the build check is the faces', and the `plugins` skill says how to write them (rule 7cb3c1cf).

## What the person sees

**The Shortcuts section** of the settings (group interface) is declared by the shortcuts feature through `SettingSections`, with its own view.
- **Rows** are grouped by owner: Tagma's areas first, then each plugin under its title. A row holds the action's title, its chords as `Kbd`, and **Rebind**.
- **Rebind** turns the chord into "Press the new chord… Esc cancels", the speech card's words today.
- **A taken chord.** When the pressed chord belongs to another action, one line under the row says so — "⌥⌘G runs Go to Merge requests." — with **Use here** and **Cancel**. **Use here** moves the chord.
- **The row menu:**
  - Add a chord;
  - Reset to default, shown only once the keys differ;
  - Remove keys;
  - on desktop, for a tap action: Work in every app, or Only in Tagma.
- **Search.** A field finds an action by its words or by its spelled chord. Focusing it changes no layout (rule 64c4abfd).
- **Notes on a row.** Each is a plain `Note` line, never red, because none of them is a failure:
  - a displaced proposal: the proposed chord dimmed, with "taken by Find or ask";
  - a global the OS refused: "Another app holds ⌥⌘G";
  - a hold global without Accessibility: the speech card's sentence, with **Open System Settings**;
  - on desktop, a plugin's chord asked for every app and not yet allowed: "Offered in every app", with **Work in every app**;
  - in a browser tab, a chord the browser keeps: "Your browser keeps this chord";
  - in a browser tab, a global row: "Works only while this tab is focused".
- **Region rows** say where they act ("In a terminal"), and global rows say "In every app". That is how shadowing and a grant read.

**The plugin card** (`app-plugins`):
- It names what the plugin brings by the face titles: "Shortcuts" and "Actions you run from the palette or a shortcut".
- Each displaced or refused shortcut stands as one sentence with **Rebind**, which opens the Shortcuts section at that action, already in capture.
- On desktop, each chord the plugin asks to have in every app stands as one sentence with its one act. Not yet allowed: "⌥⌘G opens Boards in Tagma; the plugin offers it in every app." with **Work in every app**. Allowed: "⌥⌘G opens Boards in every app." with **Only in Tagma**. A browser tab, which has no global, shows neither.

**Every shown chord comes from the table.** Each tooltip, menu tail and hint that shows a chord reads it by action id (`Keymap.keysOf(id)`). The palette's action rows show their chord in the tail (the menu grammar's `keys`, explanation 88d717d0), so the person learns a key where he runs its action.

**The Speech card** keeps its dictation rows, where a person looks for them, and draws the same chord control over the `dictation.hold` action.

## Modules and flow

- **`platform` (server):** the chord grammar, its schema, the parse and the matcher.
- **`settings`:** declares `shortcuts.bindings` and its section, and owns `settings.watch`.
- **`views`:** the `actions` and `shortcuts` points, the `views.actions` feed and `run_plugin_action`.
- **`plugins`:** an update keeps its place in `plugins.installed`.
- **`plugin-host`:** unchanged; it executes `tagma` tools on demand.
- **`@runlith/tagma`:** `action()`, and the `actions` and `shortcuts` fields.
- **`app-keys` ([[23e74cc4]], kit)** is the mechanism, and imports no feature. It holds:
  - the effective table it is handed;
  - regions;
  - handler chains by action id;
  - dispatch, taps in the bubble phase and holds in the capture phase;
  - `keysOf` and `actionAt`;
  - the chord capture;
  - the publication to the desktop, and the answers that come back;
  - `resolveKeys`;
  - two ports: `ShellKeys`, and `ActionRunner`, through which a dispatched action reaches its declared `run` (rule e090f46d).
- **`workspace`:** the `Actions` point and the `Action` type.
- **`app-chrome`:** `ActionRegistry` fills `ActionRunner`. The `ActionEnv` builder moves into it from `CommandPalette.svelte`, so the palette and a key press get one env.
- **The shortcuts feature, `features/shortcuts` (new, product; its card lands with the code):**
  - it reads `Actions`, `shortcuts.bindings` through `settings.watch`, and `ShellKeys`;
  - it computes the table with `resolveKeys` and hands it to `Keymap`;
  - it owns the Shortcuts section and the chord control;
  - it answers the plugin card: `displaced(plugin)`, and `globals(plugin)` — the chords the plugin asks to have in every app, each allowed or not.
- **`executions`:** the terminal's acts become actions; `TerminalKeymap` keeps the encodings and the policy.
- **`speech`:** the `dictation.hold` action, held through `Keymap.hold`. Its global chord reaches main in the table `Keymap` publishes, like every global.
- **`plugin-views`:** contributes plugin actions from the feed.
- **`app-plugins`:** the card's lines with **Rebind**, **Work in every app** and **Only in Tagma**.
- **Desktop:**
  - `GlobalShortcuts` in `desktop-host`;
  - main's global set, and its answer for each chord;
  - interception where the menu collides with a chord, and inside served frames;
  - the list of chords the shell keeps.

  `tabKeys.ts`, the tab command channel and `QuickHideShortcut` go.

**Data flow.** Actions, the person's bindings and the shell's list go into `resolveKeys`, and the table it returns goes to `Keymap`: dispatch and labels in the window, interception and globals in main. Main's answers come back to the rows. A rebinding goes through `write_setting_layer` to `SettingChanges`, then through `settings.watch` to every window, and each window resolves again.

## Cost

- `resolveKeys` is linear in actions times chords, a few hundred. It runs when an input changes, never per press.
- A press is a map lookup by normalized chord per region; today `press` walks every binding.
- The window publishes to main only when the table changes.
- The server does no work per press, except a plugin action's call.

## Order inside step 3

1. **The mechanism.** The chord grammar and matcher at `platform`; `Actions` with keys; `Keymap` by action id. Tagma's own keys move into the table — the shell's list, the terminal, close and reopen, dictation, hide and show — and chord labels come from the table.
2. **The person's keys.** `shortcuts.bindings`, `settings.watch`, the Shortcuts section and its conflicts.
3. **The desktop.** The globals grant, interception where the menu collides, and served frames.
4. **Plugins.** The `actions` and `shortcuts` points, `views.actions`, `run_plugin_action`, the person's grant of a plugin's global, the SDK fields, a stable install order, and the `plugins` skill.

## Acceptance

Performer checks, each through the door its real caller uses.

**The table:**
- **`resolveKeys`** (the public function of `app-keys`):
  - the person wins over Tagma, and Tagma over plugins by rank;
  - a displaced proposal names its holder;
  - a global displaces every local binding on its chord;
  - a region binding shadows a window binding, and no conflict is reported;
  - a capture that takes a held chord returns the person's layer with the move recorded;
  - a plugin's chord asked for every app resolves as a window chord, and as a global once the person's entry allows it.
- **No double hold.** No two of Tagma's own defaults hold one chord, on any host — macOS, Linux and Windows desktop, and a browser tab — measured against each host's shell list. The test runs over the composed `Actions` point, and it settles ⌘R on macOS desktop, held today by the terminal's rename and the menu's reload.
- **One matcher.** The terminal's layout cases (`terminal/Keymap.test.ts`) pass against the platform matcher. The desktop's interception judges the same presses the same way, in a unit test over Electron `Input`.

**The person's keys:**
- **Rebinding** (an app test that mounts the graph). Moving Find or ask from ⌘K to ⌥⌘K writes `shortcuts.bindings` through `write_setting_layer`. Afterwards:
  - the TopBar tooltip and the palette row show ⌥⌘K;
  - ⌘K no longer opens the palette, and ⌥⌘K does;
  - a second window's table follows through `settings.watch`.
- **Dictation.** Its window key and global key come from the table. Rebinding it in Shortcuts or in the Speech card changes both screens, and holding the new chord dictates.

**Plugins:**
- **Plugin actions** (a server itest through the SDK build and an `install_plugin` from a folder):
  - `views.actions` lists the plugin's actions, its proposed chords, its rank and its projects before its process has ever run;
  - `run_plugin_action` from the operator door wakes the idle process, and the handler sees the project;
  - a shortcut naming an undeclared action fails the build and the install with the same reason;
  - an update keeps the rank.
- **A taken chord.** A plugin's shortcut on ⌘K stays unbound. Its card says what holds the chord, with **Rebind**, and **Rebind** opens the Shortcuts section at that action, in capture.
- **Where a press acts.** A plugin section's shortcut pressed in a project that does not enable the plugin opens the section in the first project of the project list that does.
- **A global waits for the person** (an app test that mounts the graph, desktop host). Right after `enable_plugin`, the plugin's local shortcut works. Its chord asked for every app acts inside Tagma and is absent from the global set the window publishes. **Work in every app** on the card writes the person's entry through `write_setting_layer`, and the published set gains the chord; **Only in Tagma** removes it.

**The desktop** (unit tests with Electron's `globalShortcut` mocked, as in `projectWindows.test.ts`):
- a published global registers;
- a taken chord comes back as taken, and its row says so;
- the set survives the last window closing;
- a press with no window open opens one and runs the action there;
- ⌘W is intercepted because the menu holds it, and reaches `tab.close`'s chain.

## Not established

- Whether Electron's `globalShortcut.register` refuses a chord macOS itself uses (⌘Space, ⌘⇧4) or takes it over, and how it behaves on Linux under Wayland.
- Whether a menu accelerator fires when the page handles the same chord; today's ⌘R double hold on macOS rests on this.
- That the logical-first matcher reads ⌘ chords on non-Latin layouts correctly in Chromium and WebKit; the terminal's tests cover its own cases only.
- Delivering a global press when no window is open — opening one and running the action once it loads. This is reasoned, not run.

## Rewritten when the code lands

- the `app-keys` card [[23e74cc4]], which today says the last declared binding wins;
- explanations [[9735af57]], [[85824838]] and c5ab447d;
- the desktop card 2f69b0c4, on its one quick-hide chord;
- the palette feature 40beeb16;
- the `plugins` skill.
