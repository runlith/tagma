---
id: 01a15666-29d3-7512-8c0c-71e385742042
title: "Inventory: how the catalog's 389 operations derive place from their subject, at 57eabe825a"
ord: 1
---
Taken from the assembled catalog (`composition/catalog.ts` `OPERATIONS` and `composition/bodies.ts`) at `57eabe825a`: 389 operations. For each, `place`, `subject`, `everyProject`, the presence of a `project` field, the body hooks `place`/`files`, and the entry fields were read. Candidate subject fields were shortlisted by name (`blockId`, `scopeId`, `parentId`, `rule`, `root`, `rootId`, `checkout`, `worktree`, `path`, `threadId`, `cursor`, and relatives), then the suspicions were read in the body code. The "probe" is a call from a thread homed at runlith (5) over rule `18ad9402` or checkout law-lab (39) without `project`.

## Derive place correctly

- Graph operations through `targeted` (`read_block`, `read_zone`, `read_brief`, `graph_overview`, `ready_work`, `read_events`, `read_amendments`, `anchor_block`, `unanchor_block`, `create_block`, `update_block`, `edit_block`, `link_blocks`, `unlink_blocks`, `delete_block`, `restore_block`, `claim_block`, `release_block`, `finish_block`, `close_block`, `accept/uphold/revise/reject_amendment`, `supersede_block`, `unsupersede_block`, `set_law_enabled`, `set_law_delivery`): place is the block's graph. `read_titles` searches the whole machine by design; the probe answers `projectId: 39`.
- Reflections (`file_reflection`, `answer_reflection`, `unanswer_reflection`): place is fixed, `everyProject`.
- File tools (`subject: 'file'`, `record_write`) and `submit_work` (`selectCheckout`).
- Checkout reads and actions by root (`read_checkout`, `read_checkout_history`, `read_commit`, `stage/unstage/discard/push/fetch/abort_checkout`, `commit_checkout`, `pull_checkout`): the body finds the root across the whole machine ([[2086e7fd]]). The probe `read_checkout` with a law-lab path answers with the law-lab checkout. The call itself still stands at home: holder labels (`HolderLabels`) are taken from the home graph — a conclusion from code, not a probe.
- `read_changes` with an absolute path in another checkout: the probe answers with law-lab's lines.

## Defects: a subject exists, but no place is derived

| Operation | Subject | What is wrong | How established |
| --- | --- | --- | --- |
| `check_law` (`inspection` + `blockId`) | block | reach counts over the home graph (`ruleReach` over `ownGraph`): false `reach-empty` | probe ([[7769efcd]]) |
| `check_law` (`over: 'change'`) | — | description promises "the main checkout of `project`", but there is no `project` field | code |
| `check_law` (`over: 'staged'`), `record_commit` | `root` | judged by the calling project's rules, while the description says "by the project that holds `root`" | code; probe with `staged` without staged paths does not discriminate |
| `enforce_law` without `project` | block | prepare finds someone else's rule, but reach runs over the home graph: the same `reach-empty` | code, not a probe (a write) |
| `read_enforcement` with `rule` without `project` | block | `engineReading` gets the home project and another project's rule string | code; probe answers `not-enforced` with and without a project — the rule is not enforced, the probe does not discriminate |
| `set_module` without `project` | module-card block (`modules[].block`, `parent`) | the map is read from the calling project; another project's card refuses | code (review) |
| `read_inspections` and other project-data pages with `cursor` | cursor | the page's question carries no project (`selection: {}`): page B's cursor, handed to a call in A, answers with A's data | code (review) |
| `read_block_log`, `read_block_diff` | block | look the name up only in the calling graph: `not-found` | probe; answers with `project: 39` |
| `read_owners`, `read_gauges`, `search_blocks.path`, `read_path_exists` | path | an absolute path in another project: `source-outside`/`path-outside-tree`, while the refusal itself offers "an absolute path inside it" | probe |
| `check_worktree_merge`, `merge_worktree`, `cancel_worktree_merge`, `open_worktree_pr`, `update_worktree`, `rename_worktree`, `delete_worktree`, `clean_up_worktrees` (the `rootIds` list: sets only the project) | worktree `rootId` | look the root up only in the calling project; no `project` field, and from another home thread the only way out is cwd | code; probe answers "in this project" |
| `read_repositories` | path | a path in another project answers with an empty list, so from a foreign thread no `repository` for `prepare_worktree` can be obtained | probe |
| 56 thread operations with a `project` field from `threads/contract/wire/project.ts` (`read_thread`, `set_thread_title`, `archive_thread`, `move_thread`…) | thread | another home's thread refuses `foreign-project` until `project` is named, though the id is machine-unique | field description and doctrine; not a probe |
| `perform.ts`, entry into place | — | law delivery (`law-unread`) depends on the `project` field rather than on the place not being home | code |

## A project with no subject and no `project` field

For now such operations act only in the environment project; from another home thread only through cwd `tagma op`. By code or description: `list_worktrees`, `list_worktree_cleanup`, `read_mcp_servers`, `enable_plugin` ("this project sees it"), `read_agent_library`. Not verified by probe.

## Recheck in translation

- Commands and terminals (`read_commands`, `read_command`, `read_terminals`, `read_terminal*`): keyed by the calling project. The probe showed that this thread's command with a `workdir` in law-lab is recorded under runlith, so the shape is likely `'home'`; how `tagma op` from another project's cwd behaves was not verified.
- `start_terminal.cwd`, `adopt_harness_session.cwd`, `spawn_agent.worktree`, `move_thread.worktree`, `prepare_worktree.repository`/`destination`, `read_authorship.rootId`, `strip_comments.path`, `import_output.from/to`: path or root, place not read.
- Operator file operations on checkouts (`read_directory`, `find_files`, `place_path`, `reveal_entry`, `write_document`, `write_file`, `create_entry`, `move_entries`, `trash_entries`, `restore_entries`, `open_in_editor`): `root` + `path`, the body takes the calling project's project (`Documents.placeOf(call.project.id, …)`).
- `write_command_rule.project`, `read_command_rules.project`: rule scope, a value rather than a place.
- Operations with neither subject fields nor `place` (about 200: accounts, adapters, plugins, devices, notifications, performance): shape `'machine'` or `'home'` depending on whether the body reads CurrentProject.
