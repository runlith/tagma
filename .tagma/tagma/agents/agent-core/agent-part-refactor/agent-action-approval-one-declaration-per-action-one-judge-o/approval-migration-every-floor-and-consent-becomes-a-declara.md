---
id: 01a11c26-7d19-7b9a-8bcc-295b4946aca5
title: "Approval migration: every floor and consent becomes a declaration, a condition or a refusal; stored questions, receipts and thread_mandate migrate once"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/store/consents.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/capability.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/capability.ts
  - kind: file
    ref: packages/agent/src/collaboration/spawnLimits.ts
---
Goal: in one cut, every current floor and every consent becomes one of three:
- an explicit approval declaration or condition ([[2ebe1a79]]);
- a typed owner refusal;
- nothing, when the operation is operator-owned.

Stored questions, receipts, settings and `thread_mandate` migrate once ([[acb620dd]]). Trust, review and bypass behavior stays today's everywhere except bold-marked rows: operator decisions and proposals not yet accepted.

Today's behavior read at `4681dc8387` (after `f7841cfb16` and `c2723c1240`):
- trust asks only by floor, consents in trust pass silently;
- review asks by floor, by consents and about every non-pure read;
- bypass asks about nothing;
- "10 min" is `lapses` plus the `agent.questionWait` default.

Every target names the timeout explicitly: a duration or `none` — waits for an answer.

## Every action gets explicit approval

No action has default approval. The cut writes every operation's and every tool's declaration; the family's shared part goes in its constant. A mechanical rule repeating today's review behavior:
- pure reading — `asksFrom: 'never'`;
- the rest — `asksFrom: 'review'`, `timeout: 'none'`.

Differences are listed in the tables below. Operator operations also get a declaration by that rule: it takes effect when the operator opens such an operation to agents ([[2ebe1a79]]).

Declarations not judged by that rule:
- **Native tools:**
  - `read`, `grep`, `glob`, `ls` — `never`;
  - `write`, `edit`, `delete`, `rename`, `bash`, `webfetch`, `websearch` — `review`, `none`.
- **MCP-server tools** — one declaration per module class: reading — `never`, the rest — `review`, `none`.
- **Vendor tools** — vendor adapter rows. Today those are `KINDS`/`MUTATES`: `bash` is execute, `write`/`edit`/`delete`/`rename` is write, `webfetch`/`websearch` is network, the rest is reading. Hence: reading — `never`, the rest — `review`, `none`.

## Floors → declarations

| Now | Declared at | Actions | Now: trust · review · bypass | Target |
|---|---|---|---|---|
| `review` (`REVIEW_RULE`) | `modes/builtin.ts` | every non-pure read | — · asks · — | explicit `asksFrom: 'review'`, `none` by the rule above |
| `graph-crossing`, subjects `graph-project://*`, lapses | capability `graph` | graph operations whose subjects name another project (`graphSubjects`, `workSubjects`) | 10 min · 10 min · — | no condition: the act's place does not change approval ([[1013e071]]) |
| `settings-write` | capability `graph` | `write_setting` | asks · asks · — | `asksFrom: 'trust'`, `none` |
| `command-rule-write` | capability `graph` | `write_command_rule`, `remove_command_rule` | asks · asks · — | `asksFrom: 'trust'`, `none` |
| `archive-beyond-subtree`, lapses | capability `threads` | `archive_thread`, `archive_threads` outside the subtree | 10 min · 10 min · — | the `outside-subtree` condition on `trust` in those actions, 10 min |
| `delete-ends-a-thread-for-good` | capability `threads` | `delete_thread` | asks · asks · — | `asksFrom: 'trust'`, `none`, `why` from today's reason |
| `pin-rearranges-the-readers-list`, lapses | capability `threads` | `pin_thread` | 10 min · 10 min · — | `asksFrom: 'trust'`, 10 min |
| `folders-rearrange-the-readers-list`, lapses | capability `threads` | `create_thread_folder`, `rename_thread_folder`, `move_thread_folder`, `delete_thread_folder`, `file_threads` | 10 min · 10 min · — | `asksFrom: 'trust'`, 10 min |
| `operator-operation` (floor and consent) | `invocation/admission/callers.ts` | 76 operations with `callers: 'operator'` | asks · asks · passes | **to the agent `operator-only` in every mode until the `callers` field opens** |

No operation's `callers` field changes in this work. Operator operations:

`answer_question`, `begin_sign_in`, `branch_thread`, `build_checkout`, `compact_thread`, `complete_sign_in`, `create_entry`, `create_pairing`, `detach_thread`, `discover_accounts`, `end_machine_process`, `end_residual`, `end_residuals`, `find_files`, `finish_recognition`, `generate_thread_recap`, `import_accounts`, `list_accounts`, `list_console_keys`, `list_devices`, `list_thread_window`, `mark_thread_seen`, `move_entries`, `place_path`, `prepare_downgrade`, `queue_turn`, `read_agent_skills`, `read_attention`, `read_cache_lifetimes`, `read_compaction_summarizers`, `read_directory`, `read_machine_state`, `read_model_defaults`, `read_model_favorites`, `read_provider_token`, `read_push_status`, `read_remote_access`, `read_rewind`, `read_rewind_points`, `read_sign_in`, `read_thread_composition`, `read_thread_entries`, `read_thread_entry`, `read_thread_held`, `read_thread_snapshot`, `read_workspace_sources`, `refresh_accounts`, `reload_workspace_sources`, `remove_account`, `remove_console_key`, `rename_account`, `restart_server`, `restore_entries`, `restore_thread`, `reveal_entry`, `revert_lines`, `revoke_device`, `rewind_thread`, `save_console_key`, `set_default_account`, `set_model_defaults`, `set_model_favorites`, `set_thread_authority`, `set_thread_model`, `start_turn`, `steer_turn`, `stop_build`, `stop_run`, `subscribe_push`, `trash_entries`, `unqueue_turn`, `unsubscribe_push`, `write_document`.

New operations of this work ([[52a9ca4e]]):
- operator-owned — `set_thread_approves` and `set_thread_approver`;
- flow protocol — `answer_approval`, `asksFrom: 'never'`.

## Consents that become refusals

These are system facts, not approval. **Operator decision:** spawn past the limit and spawn with delegation off refuse immediately in every mode, including bypass, with a typed code.

| Now | Actions | Now: trust · review · bypass | Target |
|---|---|---|---|
| `delegation-off` | `spawn_agent`, including launches with `fork` | passes · asks 10 min · passes | **`delegation-off` refusal**; unblock: the operator enables delegation (`/delegation`) |
| `depth-exhausted` | `spawn_agent` | passes · asks 10 min · passes | **`depth-exhausted` refusal**; unblock: do the work yourself or ask the operator to raise `agent.subAgentDepth` |

The codes already exist among the plane refusals (`planeRefused` in `births.ts`). Removed:
- `spawnLimits` as a consent list;
- the `asked` waiver in `ThreadSpawnRequest` and `Births.spawn`;
- limit raising in `spawn_agent` prepare (`CollaborationTools.ts`).

The "asks the operator first" words about spawn limits in the `spawn_agent` description and the collaboration doctrine become "refuses with its code".

## Consents → conditions

Today each such condition asks only in review: in trust it passes silently, in bypass too. The target is written as "rung · timeout".

| Condition | Declaration owner | Actions raising it | Timeout now | Target |
|---|---|---|---|---|
| `outside-subtree` | thread-record (`strangerConsents`) | `move_thread`, `set_thread_title`, `set_thread_operator_notice`, `set_thread_transport`; `archive_thread(s)` on `trust` (floor row above) | 10 min | `review` · 10 min |
| `own-lineage` | collaboration (`lineageSubjects`); threads references | `archive_thread(s)` of its own line; `interrupt_agent` of self or ancestor; `stop_agent`, `continue_agent`, `set_agent_model`, `send_task`, `compact_agent`, `rewind_agent` to self or ancestor (today `not-a-child`/`not-a-descendant` without lapses) | none | `review` · `none` |
| `thread-running` | threads (`archiveConsents`) | `archive_thread(s)` with running flows | 10 min | `review` · 10 min |
| `not-a-child` | collaboration (`reach.ts`) | `stop_agent`, `continue_agent`, `set_agent_model` to a flow outside its own subtree or below a child | 10 min | `review` · 10 min |
| `not-a-descendant` | collaboration | `send_task`, `compact_agent`, `rewind_agent` outside the subtree | 10 min | `review` · `none` |
| `new-worktree` | collaboration (`worktreeSubjects`) | `spawn_agent` with `worktree: new`, only at `agent.worktrees: ask` | 10 min | **operator decision: `trust` · 10 min** (see below) |
| `shared-checkout-sweep` | agent-tools (`bash/tool.ts`) | `bash` | 10 min | **proposal: `trust` · 10 min** |
| `commit-elsewhere` | agent-tools | `bash` | 10 min | `review` · 10 min |
| `held-elsewhere` | graph (`heldConsent`) | `claim_task`, `release_task`, `finish_block`, `close_block` and other operations with `workSubjects`, `apply_batch` | none | `review` · `none` |
| `private-project` | graph | `set_project_storage` | none | `review` · `none` |
| `operator-choice` | settings | `write_setting` of an `operatorOnly` key | none | `review` · `none`; the action itself asks with `trust` |
| `setting-layer` | settings | `write_setting_layer` | none | `review` · `none` |
| `mode-withheld` | threads (`routes.ts`) | `create_thread` with `approvalMode` | none | **proposal: `trust` · `none`** |
| `thread-archived` | threads | `create_thread` under an archived parent | none | `review` · `none` |
| `command-ceiling` | executions (`commandCalls.ts`) | `change_command_limit` above the command-rule ceiling | none | **proposal: `trust` · `none`** |
| `not-holder` | executions (`terminalActs.ts`) | `write_terminal`, `interrupt_terminal`, `resize_terminal` of a foreign terminal; `transfer_terminal` | 10 min | `review` · 10 min |
| `debt-grows`, `debt-unowned` | enforcement (`enforce.ts`) | `enforce_rule`, `set_module` | none | `review` · `none` |
| `agent-running`, `root-in-use` | worktrees (`retirement/guards.ts`); landing references | `archive_worktree`, `delete_worktree`, `clean_up_worktrees`, `merge_worktree` | none | `review` · `none` |
| `uncommitted` | landing (`merge/coordinator.ts`) | `merge_worktree` | none | `review` · `none` |
| `lines-of-another`, `still-running` | change-record (`prepared/place.ts`) | `submit_work` with `taking` | none | `review` · `none` |
| `install-running` | speech | `remove_speech_model` | 10 min | `review` · 10 min |
| `mcp-env-resolving` | mcp | `add_mcp_server` | none | `review` · `none` |
| `build-running` | installation | `build_checkout` (operator-owned) | 10 min | removed: the operation is unavailable to agents, and the operator is not judged |
| `operator-operation` | invocation | — | — | floors row above |
| `skippable` | `thread/conformance/hosting.ts` | test | — | replaced with the test's condition on the new type |

**`agent.worktrees` is the operator's decision.** The setting affects trust only and has two values:
- `allow` — a new worktree is made without a question;
- `ask` — `spawn_agent` prepare raises `new-worktree`, and trust asks.

Bypass does not read the setting and executes. Review asks about `spawn_agent` on its own `review` rung, like any non-pure read, at any setting value. At `ask` the review question also carries the `new-worktree` cause, and then the deadline follows the smallest-timeout rule — 10 min.

The setting description is rewritten: "Whether trust asks before an agent cuts a new worktree for its child; review always asks, bypass never does". Today it says "approves each one under review and trust, and bypass makes it silently", while trust does not ask.

Bodies that today read admitted consents read admitted conditions:
- `crossed` in `reach.ts` — recheck at execution;
- `set_project_storage` removes `private`;
- `terminalActs` with `takes: true`.

A condition raised at execution but not admitted refuses with its own id, as today.

## Stored data

Drizzle migrations (`drizzle/`), once:

1. **`thread_mandate`** gains `approves` (null) and `taken_over` (false) ([[52a9ca4e]]).
2. **Open native- and hosted-questions** move to the `Questions` journal on the [[fb39e560]] migration with the same ids. That spec adds:
   - their approver is the operator: no grants exist before migration;
   - the deadline is not recorded, so such a question waits for an answer (`none`): today's deadline was derived from `reader.withinMs` at each read and is not stored.
3. **Answered questions** are not rewritten. An answer with no `by` is the operator's answer, and that is the current form, not a reading of the old one: the writer writes `by` only for a flow.
4. **An open `facet.question` with `source: 'hook'`** becomes a `Questions` record with the same id: `record_harness_outcome` finds it by `requestId`. The facet slot is cleared.
5. **An open `facet.question` with `source: 'consent'`** closes without an answer. The `harness_consent` table leaves with the receipts. The action key now counts over raised conditions, not consent facts, and no old receipt fits a repeat. Repeating such an action asks again — the migration's only loss.
6. **Settings.** `agent.questionWait` leaves with its stored values (operator decision). `agent.approves` and `agent.takeover` have no stored values.
7. **`authority.mode` with an unregistered id** stays as is. The judge refuses such a flow with `contributor-absent`, as today, and the operator changes the mode.

## Acceptance criteria

- A migration test on a database holding:
  - an open native confirmation — answered with the same id, approver is the operator;
  - an answered native confirmation — read as answered by the operator;
  - an open hook question — `record_harness_outcome` delivers the answer given through `answer_question` by `requestId`;
  - an open consent question with a receipt — closed, no `harness_consent` table, repeating the action places a new question;
  - `thread_mandate` without the new columns — `approves` null, `taken_over` false;
  - a stored `agent.questionWait` value is deleted.
- A test of real declarations through `judge` (not a table snapshot): in trust, review and bypass they give this table's row:
  - `delete_thread`, `write_setting`, `pin_thread`;
  - `archive_thread` outside and inside the subtree;
  - `move_thread` outside the subtree;
  - `bash`;
  - `read`.
- A `spawn_agent` test in all three built-in modes, including bypass:
  - past depth — `depth-exhausted`;
  - with delegation off — `delegation-off`.

  No question is placed, no flow is born.
- `rg`: no `consentSubjects(`, `lapses` or `questionWait`; `spawnLimits` has no `Consent`.
