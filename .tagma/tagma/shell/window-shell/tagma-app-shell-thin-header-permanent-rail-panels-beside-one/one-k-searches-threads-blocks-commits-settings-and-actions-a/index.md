---
id: 01a10891-853e-7f52-89f5-9e2b0ed5d929
title: One ⌘K searches threads, blocks, commits, settings and actions, and asks the Tagma agent
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0ff2b-54ff-7f7f-91d2-8f5114618abd
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/CommandPalette.svelte
  - kind: file
    ref: apps/tagma/server/src/workspace/contract/wire/checkoutReads.ts
  - kind: file
    ref: packages/git/src/history.ts
---
One ⌘K finds threads by what was said in them, blocks, commits, settings and actions. The last row is “ask the Tagma agent”. Exact results arrive at once, the agent's answer only on explicit request, and the query itself launches nothing.

## What is there now

`lib/app/chrome/CommandPalette.svelte`:
- calls only `search_blocks` of the current project, limit 40;
- narrows only by `tag:` and `status:`;
- “Go to” and “Tagma” groups hardcoded and unfiltered by the query;
- no debounce or previous-request cancellation;
- outside a project (`/settings`) the query goes out with no project and gets a `project-required` refusal, and the block link builds as `/undefined/b/…`.

Content search over threads is built ([[14618abd]]): `search_threads` with `projects: 'all'`, coverage and cursor. The thread-column filter already uses it; the palette does not.

## What it finds

Groups stand in fixed order; each arrives with its own query and draws as it answers.
1. **Threads** — `search_threads`. Current project by default, the `All projects` chip widens. Outside a project — all. Row: name, project if different, highlighted fragment, time. Coverage honesty holds: `N threads not indexed yet`, hint on `query-too-short`, `atLeast` instead of exact total.
2. **Blocks** — `search_blocks` on `Workspace.contextProject`; the outside-project refusal and `/undefined` go away. `tag:` and `status:` narrowing stays.
3. **Commits** — `read_checkout_history` gains a `grep` input: a case-insensitive substring of the commit message, up to the cursor. Git-kit `logAt` gains the matching parameter (`git log --grep -i`). An addition to the workspace module and to git kit; the test is on the operation contract.
4. **Settings** — the context project's `read_settings` catalog, client-side filter. Matching is reused from `features/settings/SearchResults.svelte` and moved into a shared matcher, not copied. Jump is `settingsHref(section, scope)` with a new key parameter: the settings page scrolls to that setting and highlights it.
5. **Actions** — each feature declares its actions in a `lib/features/*/actions.ts` file: id, title, keywords, run, availability condition. The app collects them via `import.meta.glob`, as it now collects `settings.ts`. A central list of others' actions is forbidden (rule [[edea5454]]). Starting set:
   - New thread;
   - New terminal;
   - Toggle column;
   - Split right (after [[5c88840b]]);
   - Theme System, Light, Dark;
   - Settings;
   - Agent library;
   - New project;
   - New worktree;
   - Go to sections;
   - the two current “Update Tagma”.

With no prefix each group shows its first three. `Show all N` expands the group with cursor loading.

## Prefixes and keys

- `>` — actions, `@` — threads, `#` — blocks, `?` — ask the agent.
- `Tab` switches group chips: All, Threads, Blocks, Commits, Settings, Actions.
- `↵` opens, `⌥↵` opens a thread in a panel beside ([[5c88840b]]), `⌘↵` — ask the agent.
- `Esc` closes.

## Ask the agent

The last row is always: `Ask Tagma: «query»`. Choosing it creates a regular Tagma-agent thread in the context project; the first message is the query plus a request to answer with links to the found threads, blocks and commits. The thread opens in a panel beside, and until [[5c88840b]] exists — by navigation.

No new server machinery: the Tagma agent already has `search_threads` and `search_blocks`, and every agent run in the product is a thread that can be continued. An answer right in the palette, from the mockup, was rejected: it would need a second run kind outside threads.

## How it is built

- The palette stays a `Palette` overlay in `lib/app/chrome`. Each group is a separate source with its own query.
- Each input cancels previous queries; no debounce (rule [[2393aff1]] and decision [[f07ab3f2]]).
- The header field ([[54780672]]) opens the palette.

## Acceptance

- From `/settings` the query finds threads, blocks, settings and actions, and the block link leads to the context project.
- A query by a word from the middle of a conversation finds another project's thread under the All projects chip and opens it in the right project.
- `>theme` finds the three theme actions, and choosing changes the theme.
- `read_checkout_history` with `grep` returns only commits with that substring in the message; integration test on the operation.
- Fast typing never shows results of a stale query.

## Out

- File search: no arbitrary-file view.
- Semantic search — [[5ce71527]].
- Opening the feed on the found message — [[d6589a26]].
