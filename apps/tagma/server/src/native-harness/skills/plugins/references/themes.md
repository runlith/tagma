# Themes: a plugin that changes how Tagma looks

A theme is data in the definition: `themes` maps a theme id to `{ title, light?, dark? }`, with at least one look. It needs no process, so a plugin made only of themes runs nothing. Its full id is `<plugin>.<theme>`; Tagma's own theme is `tagma`.

```ts
import { definePlugin } from '@runlith/tagma/plugin';

export default definePlugin({
  id: 'nord',
  title: 'Nord',
  themes: {
    nord: {
      title: 'Nord',
      dark: {
        surfaces: { chrome: '#242933', background: '#2e3440', field: '#3b4252', raised: '#3b4252', popover: '#3b4252', sunken: '#242933', muted: '#3b4252', accent: '#434c5e' },
        text: { foreground: '#eceff4', muted: '#d8dee9', primary: '#eceff4' },
        signals: { here: '#ebcb8b', neutral: '#8b93a3' },
      },
    },
  },
});
```

## What a look sets

Every key is optional: one left out keeps Tagma's value for that look, so a theme stays small and keeps working when Tagma adds a colour. A colour is `#rrggbb` or `oklch(L C H)`, always opaque; Tagma derives every border, hover, selection, ring and shadow from them.

- `surfaces`: `chrome` (rail, top and status bars), `background` (feed and pages), `field` (inputs), `raised` (cards), `popover` (menus, palette), `sunken` (code blocks), `muted`, `accent`.
- `text`: `foreground`, `muted` (hints, stamps), `primary` (the primary action).
- `signals`, each keeping its meaning: `failure` red, `stale` orange, `work` amber, `here` gold (you are here), `done` green, `waiting` and `change` blue, `neutral` grey.
- `syntax`: `text`, `declaration`, `property`, `punctuation`, `operator`, `comment`, `keyword`, `string`, `function`, `type`, `constant`.
- `marks`: `project` (exactly 8) and `worktree` (exactly 6), quiet colours that tell places apart.
- `terminal`: the 16 ANSI colours, `black` … `brightWhite`. The terminal's background, text and cursor follow `surfaces.background`, `text.foreground` and `signals.here`.

Fonts, sizes, radii and spacing are not a theme's.

## The check

The build and the install run the same check on every look, merged over Tagma's, and stop with the key, the value and what to change:

- each signal stays in its family's OKLCH hue window — failure 322°–31°, stale 31°–55°, work 55°–78°, here 78°–120°, done 120°–202°, waiting and change 202°–322° — with chroma at least 0.08; `neutral` at most 0.03;
- signals of different families stand at least 15° apart;
- every signal reaches 3:1 against `background`, `chrome`, `raised` and `popover`; `text.foreground` and `text.muted` reach 4.5:1 against every surface;
- a syntax role or mark with chroma 0.03 or more stands at least 21° from every signal hue; syntax chroma stays below the weakest of failure, work, done, waiting and change; marks stay at chroma 0.08 or less;
- surfaces and text stay at most half the weakest signal's chroma.

A theme that changes surfaces usually has to retune `neutral` and the muted text to keep their contrast. A VS Code theme puts code colours on the signal hues: port it by retuning what the check names.

## Using it

A theme the person asks for is theirs, not the project's: start it with `create_plugin {scope: "user"}`, which writes it among their own plugins in Tagma's data folder, where no repository carries it, and install it from that folder with `scope: "user"`. A theme a project ships for its team is created without `scope` into the project's `.tagma-plugins/<id>/`.

After `install_plugin` (`scope: "user"` offers it in every project), the theme stands among the person's choices while its plugin runs anywhere. `write_setting {key: "appearance.theme", value: "<plugin>.<theme>"}` makes every window of the person paint it; `appearance.mode` is `system`, `light` or `dark`, and a theme with one look shows that look whatever the mode.
