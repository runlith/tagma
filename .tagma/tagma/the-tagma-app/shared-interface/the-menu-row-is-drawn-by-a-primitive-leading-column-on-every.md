---
id: 01a174df-7c1c-7a0c-9397-47b788d717d0
title: "The menu row is drawn by a primitive: leading column on every row, mandatory mark at an action, one tail and sections in one order"
ord: 11
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16637-60ed-76a9-b850-9818aa7abca9
  - kind: relates
    to: 01a17329-c337-7a64-a107-fae3ce1ea6a4
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui/dropdown-menu
---
The primitive used to set no row: every consumer laid the icon as children with its own classes, where there was no icon words slid left, and stamps, eyebrow headers, `<p>` and `·` were pushed inside menus. The operator called it "a random junk pile". So the primitive draws the row, and the consumer passes only meaning.

- **Anatomy.** `Item`, `SubTrigger`, `RadioItem` and `CheckboxItem` draw `[14 px leading column][words][tail]`. The column stands on every row, even empty, so words in all menus start at one x. Words go into `FadeText`. The column sets the icon size and tone: muted at rest, text colour on highlight, `destructive` on a destructive item.
- **A mark is mandatory in the type.** A non-`unstyled` `Item` and `SubTrigger` must have an `icon` (a Lucide or `Glyph`-based icon) or a `lead` (a custom mark: `TagIcon`, `WorktreeSwatch`, provider brand, status tile). So typecheck proves all menus are covered, and a new menu without a mark will not build. Only a value list stays without a mark (radio and checkbox), and then no row of that menu has one.
- **The tail is one thing.** The leading column says what it is, the tail says what state it is in: `keys` (shortcut), `current` (current value; at a submenu before the chevron), `hint` (monospace name, e.g. "Copy name"), `here` (gold "you are here" check) or a choice check. The type does not allow passing two at once. A custom `tail` is taken only when the state is a mark, not text (project pulse, counter, reviewer-count stepper). A `CheckboxItem` that stands for several values of one thing — a model's reasoning rungs — carries their strip (`Rungs`) in place of its check: the row toggles them all, a mixed row turns them all on, and a strip button toggles one. The menu's rows listen to clicks natively, so a control inside a row stops the click natively; a delegated `onclick` would run only after the row has already toggled.
- **Sections** go in one order and are split by `Separator`: actions on the thing, go or open, view, copying, destructive last and red.
- **No homemade rows.** A header is a `Label` or `GroupHeading` on the words column. A refusal, status and fact that is no action is one `Note` row, the fact at the very end. A fact already visible beside (the block holder in the page's meta row) is not repeated in the menu.

The single exception is the providers' usage popover: a readings panel, not an actions menu. Its "Usage" header carries a quota re-read button on the right. Its roster rows (`usage/Row.svelte`) and provider panel are quota readings with bars over windows; they stay `unstyled` rows and content. By grammar "Manage accounts…" goes at the bottom and the provider submenu: accounts and "this thread". When the update stood at the bottom as a separate section, next to density and the "updated" row, three lone items each got a rule, and the re-read button was looked for upstairs, next to the readings.
