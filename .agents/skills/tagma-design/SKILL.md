---
name: tagma-design
description: Use before deciding, changing, mocking up or reviewing anything a person sees in Tagma — a screen, panel, row, chip, mark, icon, color, motion, empty or failure state, the words of the interface — in apps/tagma/app and packages/chat-ui, and before answering how something should look or be shown. Carries where Tagma's visual language comes from, its grammar (square = state, fill = measure, diamond = place, gold = you are here, one phase), the token and color system, the rules for words, the UX laws and the order of work. How the app's code is assembled is the frontend skill.
---

# Tagma's visual language

A tagma is a Byzantine guard unit, a body "set in order": the product is a formation of agents under one operator. The sign is a helmet with a crest of square plates; the first plate leads in gold, the rest stand in rank. The interface keeps that order: every form means one thing, signals are few so each one is read, every mark moves in step, and gold stands only where the reader is. A case no rule names is decided by asking what the thing is in this grammar, never by what another app does.

The values live in `apps/tagma/app/src/app.css` (tokens) and `packages/chat-ui/src/theme.css` (the chat's tokens, mapped onto the app's in `app.css`). The reasons live in the graph, in explanations sourced to the code they govern; they arrive when you read that code. This skill is the map and the grammar; read the source for the value.

## The grammar

Ask what the thing is, then draw it so:

- **The state of something Tagma does** — thread, step, agent, project, command — is a square tile, radius 0. Thread states (`threadMark` in `apps/tagma/app/src/lib/features/threads/Life.svelte`): working is one breathing amber tile (`Working`), waiting on you blue (`--status-open`), failed red (`--destructive`), finished unread green, stalled a red outline, cut short an amber outline, quiet no mark at all. Counts of agents are tiles with numbers (`AgentCounts`). Feed steps are tiles on a thread line (`RailRow`, whose mark `chatStepMark` in `chat-ui/src/activity.ts` decides).
- **A measure** is a fill. The context share fills a square frame clockwise from the top middle (`ContextRing`); a provider quota is a crest of five tiles, 20% each (`Gauge`), drawn with `TileMeter` (`apps/tagma/app/src/lib/shared/ui`). A crest only shows; a choice is buttons with words, never tiles to hit: the reasoning rung in the model picker is a strip of word buttons (Low, Med, High, XH, Max), the chosen one on `bg-selected`.
- **A place** is a diamond — a tile turned 45° so it never reads as a state (`WorktreeSwatch`, explanation 646a9782). Its fill means the place exists: a worktree Tagma made has its own muted hue, one made outside Tagma is muted grey, the main checkout is an outline with a filled core, a missing or not-yet-made one is an empty dashed outline. Detached HEAD is a word beside it, not a mark.
- **You are here** is gold (`--brand`, `--chat-here`) and nothing else is: the current place on the rail, the open thread, the current model, the current message in the message rail, the check on the current worktree. Work is amber, never gold; success, emphasis and decoration are never gold. The helmet carries its gold plate only where it is Tagma's own sign (explanation a6452b90).
- **Motion is the formation in step.** Work breathes (`animate-breathe`); anything pending is three marching tiles (`Waiting`) — it is every spinner of the app and the chat. Both run on `--beat`; attach `inStep` to any animated mark so marks mounted at different times share one phase, and re-create a mark (`{#key}`) whose animation a class change turns on (explanation 18dd9e6b). No other spinner. No code reads reduced-motion (rule 77135f8f).
- **A change made** is blue (`--mutation`); a failure or refusal is red (`--severity-lie` in the chat, `--destructive` in the app); diff counts are green and red.

## Color and surfaces

- Surfaces and text carry no hue: the dark theme is a neutral near-black (explanation f671eb5f). Color in the window is only gold, the state colors, the muted marks of projects and worktrees and the muted roles of syntax highlighting, so any color is a signal and every color means one thing.
- Code is colored by role, never by a vendor theme: the highlighter's theme (`packages/highlight/src/theme.ts`) paints each token `var(--syntax-<role>)`, and the `--syntax-*` tokens in `app.css` hold the values for both themes, each hue at least 21° from every state hue, below the state chroma, no gold (explanation 412bbac1). The editor's caret, focused selection and current search match are gold; other matches are neutral.
- Project and worktree hues are muted (chroma 0.06 dark, 0.07 light) and stand at least 21° from every state hue (explanations f0e82349, 646a9782). A project's tile is neutral; its color is a small mark in a corner or frame. A new color token obeys the same distance, or it will read as a state.
- Surfaces: `chrome`, `background`, `field`, `raised`, `popover`, `sunken`. Selection and chips are the overlays `bg-hover` and `bg-selected`. A popover separates from the window by a step of lightness and a border, not a grey fill. A control floating over moving content — the jump-to-latest tile over the feed (`JumpToLatest`), the graph's controls over its canvas — may be translucent with a light blur; panels, menus and popovers are opaque.
- Elevation: `shadow-raised`, `shadow-float`. Text: `text-meta`, `-small`, `-ui`, `-body`, `-page`, `-title` (`text-badge` only for a count on an icon); Geist and Geist Mono.
- Radius by role (explanation aa7abca9): 0 for state marks, 6 px (`rounded-md`) for tiles, buttons and rows, 10 px (`rounded-lg`) for surfaces — menus, popovers, cards, the composer, the operator's message. An inner corner is the outer radius minus the padding, so a row inside a `p-1` surface is 6 px.
- Rule 55b5437b names every allowed class: no arbitrary `[…]` values, no Tailwind palette, no uppercase or letter-spacing, explicit `size-3`, `size-3.5` or `size-4` on every icon. Icons are Lucide; Tagma's own glyphs are drawn on `Glyph` (grid 16, line 1, shapes from soft squares).

## Words

- Neighbouring values are told apart by tone, weight or indent, never by a `·` (rule c6e02f23).
- Text that does not fit fades at the edge, never ends in an ellipsis: `FadeText` in the app, `clipFade` with `data-fade` in the chat kit; long text clips by height with `clampFade` (`ClampedText`, "Show all"). A producer never cuts text by character count; only the interface cuts, by measured size (rule 485790ef).
- A block is named to a person by its title. Its bare name — the hex handle — is not drawn in rows, cards, chips or lists; it stands only where the name itself is the subject or the only identity left: the copy button on the block's page, its menu, a link that cannot be read, a block whose row is gone.
- A path that does not fit keeps its end: the file name stays whole and the directory gives way, fading at its start (`PathText` in `shared/`; the directory goes before or after the name, a match highlight rides its `piece` snippet). The start of a path repeats across rows; the end is what tells them apart.
- A step names the act done in the producer's words ("Committed", "Wrote to an agent"). Where the producer's facts already name an outcome (`exit 1`), the interface adds no second "Failed" (explanations 35c0e724, af7f1b16).
- A failure that is an entry of the feed is a rail row with a red square (`FailureRow`); every other problem is one card (`Callout`). Red is only for a failure or a refusal (rule a5cf8cb6).
- Interface words are English and live in the strings of their owner (`packages/chat-ui/src/strings.ts`, `apps/tagma/app/src/lib/features/threads/native/strings.ts`).

## UX laws

- One mechanism, one implementation: find the component that already does it and use it, or move it to a shared place and switch every consumer in the same change (rule dd380bf6).
- An action shown only on hover or keyboard focus — an inactive tab's close, a row's copy or menu — floats over the end of its tab or row, and the text and marks under it fade with the edge `FadeText` draws; at rest the content takes the whole width. The open tab shows its close at rest, floating the same way: it is already chosen, so closing it takes no hover. Never reserve an invisible slot for it: that slot is empty space on every item nobody points at. The action may take the place of a value that hides on hover (a thread row's time yields to its actions); an action visible at all times, touch screens included, takes its place like any element.
- A menu has one grammar, and `shared/ui/dropdown-menu` owns it. A row is `[lead 14 px][words][tail]`; the lead column stands on every row, so all words start at one x. An action row passes `icon` (Lucide or a `Glyph` icon; the primitive sets its size and tone) or `lead` (its own mark: `TagIcon`, `WorktreeSwatch`, a status tile); the type refuses an item without one, and only a menu of bare values, with no mark on any row, goes without. The tail holds one thing at most: `keys`, `current` (the value now; before a submenu's chevron), `hint` (a mono name), `here` (the gold check) or a choice's check. Sections, split by separators: acts on the thing, go or open, view, copy, destructive last and red. No self-made rows: a heading is `Label`/`GroupHeading`, a message or a fact that is no act is one `Note` line, a fact last; a fact shown beside the menu is not repeated in it (explanation 88d717d0).
- A row of a list opens its thing: the whole row is that thing's link, its own buttons excepted, and its text does not select under the mouse. Editing the name is an explicit act — Rename in the thing's menu with F2 in its tail, or F2 on the focused row — never a click on the text. The thing's own page edits its name in place (explanation 0da203e8).
- A list that orders or groups its rows by live state never moves a row from under the pointer: while the pointer is over the list or a row's menu is open, the order stands and only the rows' content updates; the new order lands when the pointer leaves. Freeze the whole list, since a move above would shift the pointed row too (the worktree board, explanation 24ac8bc0).
- A link carries no hover tooltip: the row or word already names the thing, and the right-click menu teaches click and ⌘-click by the chords on its opening items. A tooltip stands on an icon-only control, to give it words. The terminal's corner strip (`LinkTip`) is the one link hint, because a terminal shows a link only under the pointer and a tracking program owns the plain click (explanation ce1ef098).
- A link in editable text opens from the keyboard only through the system's context-menu gesture (Menu key, Shift+F10, VO+Shift+M): the link under the caret answers it with the same menu as a right click, at the caret. No other key or chord is added inside text, where Enter types and ⌘-Enter breaks the line.
- A thread's own switches — opening it in its CLI, chat or terminal, the approval mode of a terminal thread — are items of the thread's menu, never icons or chips in a header. A header or toolbar row stands only while it carries something; a row for one button is not drawn. The tab strip's end carries the open tab's one way to its section, as an icon with its words in the tooltip.
- What a thread made or runs — its changes, its pages, its working agents — are rows of the one "This thread" button at the end of the thread's header (`ThisThread`), never separate icons there; a new such thing becomes a row, not a header icon. The thread's count of uncommitted changes (`ChangesCount`, the git footer's `LineCount`) stands in the header left of that button while the thread has changes and its Changes tab is not on screen; it is a link to that tab. A toggle stands beside the panel it opens: the terminals toggle is at the start of the status bar, under the terminal panel.
- The operator already has full authority: no unlock, take, claim or confirm step before an act (rule 0f144655).
- Tagma is a desktop app: panels keep their places when the window narrows and only change size; the layout changes only by the user's hand (rule e7449703).
- Opening anything answers the press at once (rule c57e2aa9).
- Decide for every user, from a novice with one thread to someone running dozens of agents across worktrees and projects (rule fe83acfa). Absence is a state: a quiet thread has no mark, a qualifier appears only where the thing differs from where the reader stands.

## Order of work

1. Read `app.css` and the components of the screen being changed; `read_owners` on the place gives its graph owner, and its explanations arrive as you read the code.
2. Name what each new thing is in the grammar above, and find the component or mark that already draws it.
3. A change the operator wants to see first is a mockup (rule 95258760): the whole screen in its surroundings, built from Tagma's own tokens, fonts, icons and components, both themes, with its states and edges and one recommendation. Publish it with the artifacts skill.
4. Build with tokens only; `check_rules` runs the token rule (55b5437b) before the commit gate does. The `·`, fade and hover-action rules have no check: read your diff for them.
5. Look at the result in a running app only when the operator asked for a live check (rule c6569513); otherwise report that it is unchecked by eye.
6. A lasting design decision is an `#explanation` sourced to the component that carries it; when the decision changes, edit that explanation in the same change.

## Where the reasons are

- 84487d7b — the operator's choice of the sign language ("Строй из плиток")
- 18dd9e6b — live marks: tiles in one phase, one breathing tile, three for pending, gold only for here
- 646a9782 — the worktree diamond and what its fill means
- f0e82349 — neutral project tiles with a muted mark
- f671eb5f — neutral dark surfaces
- 412bbac1 — code colored by `--syntax-*` roles kept off the state hues
- aa7abca9 — three radii by role
- a6452b90 — Tagma's own icons on `Glyph` and the helmet's gold plate
- afd6a883 — the project crest on a contour parallel to the tile's edge
- 35c0e724, af7f1b16 — refused and failed steps, `FailureRow` and `Callout`
- 88d717d0 — one menu grammar owned by the primitive: lead column, required mark, one tail, ordered sections
