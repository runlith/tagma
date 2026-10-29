---
id: 01a132e9-42dd-74f5-889b-891631dbed79
title: Inventory of 74 graph operations, batch verbs, and 166 refusal codes by their contracts
ord: 1
---
The inventory was taken before the rename on the `graph-vocab-contract` tree (2026-10-13). Every name is checked against the operation declaration and the refusal condition in graph/enforcement. Project-registry, storage, journal, and sources operations belong to the graph infrastructure: no catalog name is substituted in them. `task-required` at thread birth requires the task text, not the node contract, and stays out of scope.

## Operations

| id | contract / owner | name |
| --- | --- | --- |
| `accept_proposal` | `core/amendment` | `accept_amendment` |
| `add_project` | `graph core / infrastructure` | `add_project` |
| `anchor_block` | `graph core / infrastructure` | `anchor_block` |
| `answer_reflection` | `core/reflection` | `answer_reflection` |
| `apply_batch` | `graph core / infrastructure` | `apply_batch` |
| `check_rules` | `core/enforced` | `check_law` |
| `claim_task` | `core/holder` | `claim_block` |
| `close_block` | `core/lifecycle` | `close_block` |
| `create_block` | `graph core / infrastructure` | `create_block` |
| `delete_block` | `graph core / infrastructure` | `delete_block` |
| `edit_block` | `graph core / infrastructure` | `edit_block` |
| `enforce_rule` | `core/enforced` | `enforce_law` |
| `file_reflection` | `core/reflection` | `file_reflection` |
| `finish_block` | `core/lifecycle` | `finish_block` |
| `first_prompt` | `graph core / infrastructure` | `first_prompt` |
| `graph_overview` | `graph core / infrastructure` | `graph_overview` |
| `link_blocks` | `graph core / infrastructure` | `link_blocks` |
| `list_branches` | `graph core / infrastructure` | `list_branches` |
| `list_projects` | `graph core / infrastructure` | `list_projects` |
| `list_root_blocks` | `graph core / infrastructure` | `list_root_blocks` |
| `list_sessions` | `graph core / infrastructure` | `list_sessions` |
| `list_trash` | `graph core / infrastructure` | `list_trash` |
| `query_blocks` | `graph core / infrastructure` | `query_blocks` |
| `read_block` | `graph core / infrastructure` | `read_block` |
| `read_block_diff` | `graph core / infrastructure` | `read_block_diff` |
| `read_block_log` | `graph core / infrastructure` | `read_block_log` |
| `read_brief` | `core/work; core/spec; core/container` | `read_brief` |
| `read_edges` | `graph core / infrastructure` | `read_edges` |
| `read_enforcement` | `core/enforced` | `read_enforcement` |
| `read_events` | `graph core / infrastructure` | `read_events` |
| `read_gauges` | `graph core / infrastructure` | `read_gauges` |
| `read_graph_recovery` | `graph core / infrastructure` | `read_graph_recovery` |
| `read_inspections` | `core/enforced` | `read_inspections` |
| `read_journal` | `graph core / infrastructure` | `read_journal` |
| `read_journal_vocabulary` | `graph core / infrastructure` | `read_journal_vocabulary` |
| `read_law` | `core/law` | `read_law` |
| `read_owners` | `graph core / infrastructure` | `read_owners` |
| `read_path_exists` | `graph core / infrastructure` | `read_path_exists` |
| `read_project` | `graph core / infrastructure` | `read_project` |
| `read_proposals` | `core/amendment` | `read_amendments` |
| `read_reflections` | `core/reflection` | `read_reflections` |
| `read_refs` | `graph core / infrastructure` | `read_refs` |
| `read_review_brief` | `core/amendment` | `read_review_brief` |
| `read_tags` | `graph core / infrastructure` | `read_tags` |
| `read_titles` | `graph core / infrastructure` | `read_titles` |
| `read_tree` | `graph core / infrastructure` | `read_tree` |
| `read_vocabulary` | `graph core / infrastructure` | `read_vocabulary` |
| `read_zone` | `graph core / infrastructure` | `read_zone` |
| `ready_tasks` | `core/work` | `ready_work` |
| `reanchor_path` | `graph core / infrastructure` | `reanchor_path` |
| `record_commit` | `graph core / infrastructure` | `record_commit` |
| `reject_proposal` | `core/amendment` | `reject_amendment` |
| `release_task` | `core/holder` | `release_block` |
| `remove_project` | `graph core / infrastructure` | `remove_project` |
| `resolve_graph_conflict` | `graph core / infrastructure` | `resolve_graph_conflict` |
| `restore_block` | `graph core / infrastructure` | `restore_block` |
| `revise_proposal` | `core/amendment` | `revise_amendment` |
| `rewrite_graph_files` | `graph core / infrastructure` | `rewrite_graph_files` |
| `search_blocks` | `graph core / infrastructure` | `search_blocks` |
| `session_start` | `graph core / infrastructure` | `session_start` |
| `set_module` | `core/module` | `set_module` |
| `set_project_policy` | `graph core / infrastructure` | `set_project_policy` |
| `set_project_root` | `graph core / infrastructure` | `set_project_root` |
| `set_project_storage` | `graph core / infrastructure` | `set_project_storage` |
| `set_rule_enabled` | `core/law` | `set_law_enabled` |
| `supersede_block` | `graph core / infrastructure` | `supersede_block` |
| `sync_graph` | `graph core / infrastructure` | `sync_graph` |
| `touch_path` | `graph core / infrastructure` | `touch_path` |
| `unanchor_block` | `graph core / infrastructure` | `unanchor_block` |
| `unanswer_reflection` | `core/reflection` | `unanswer_reflection` |
| `unlink_blocks` | `graph core / infrastructure` | `unlink_blocks` |
| `unsupersede_block` | `graph core / infrastructure` | `unsupersede_block` |
| `update_block` | `graph core / infrastructure` | `update_block` |
| `uphold_proposal` | `core/amendment` | `uphold_amendment` |

## Batch grammar

| id | contract | name |
| --- | --- | --- |
| `create` | `graph core` | `create` |
| `edit` | `graph core` | `edit` |
| `update` | `graph core` | `update` |
| `delete` | `graph core` | `delete` |
| `restore` | `graph core` | `restore` |
| `link` | `graph core` | `link` |
| `unlink` | `graph core` | `unlink` |
| `anchor` | `graph core` | `anchor` |
| `unanchor` | `graph core` | `unanchor` |
| `supersede` | `graph core` | `supersede` |
| `propose` | `core/amendment` | `propose` |
| `claim` | `core/holder` | `claim` |
| `release` | `core/holder` | `release` |
| `done` | `core/lifecycle` | `finish` |
| `close` | `core/lifecycle` | `close` |
| `accept` | `core/amendment` | `accept` |
| `reject` | `core/amendment` | `reject` |
| `uphold` | `core/amendment` | `uphold` |

## Refusals

| id | contract / owner | name |
| --- | --- | --- |
| `already-answered` | `core/reflection` | `already-answered` |
| `already-superseded` | `graph core / infrastructure` | `already-superseded` |
| `ambiguous-name` | `graph core / infrastructure` | `ambiguous-name` |
| `ambiguous-project` | `graph core / infrastructure` | `ambiguous-project` |
| `amendment-empty` | `core/amendment` | `amendment-empty` |
| `amendment-op` | `core/amendment` | `amendment-op` |
| `amendment-outside` | `core/amendment` | `amendment-outside` |
| `amendment-ref` | `core/amendment` | `amendment-ref` |
| `amendment-shape` | `core/amendment` | `amendment-shape` |
| `amends-a-proposal` | `core/amendment` | `amends-an-amendment` |
| `amends-missing` | `core/amendment` | `amends-missing` |
| `amends-shape` | `core/amendment` | `amends-shape` |
| `anchor-ambiguous` | `graph core / infrastructure` | `anchor-ambiguous` |
| `anchor-empty` | `graph core / infrastructure` | `anchor-empty` |
| `anchor-noop` | `graph core / infrastructure` | `anchor-noop` |
| `anchor-not-found` | `graph core / infrastructure` | `anchor-not-found` |
| `answer-shape` | `core/reflection` | `answer-shape` |
| `bad-cursor` | `graph core / infrastructure` | `bad-cursor` |
| `bad-document` | `graph core / infrastructure` | `bad-document` |
| `bad-name` | `graph core / infrastructure` | `bad-name` |
| `bad-since` | `graph core / infrastructure` | `bad-since` |
| `batch-ref` | `graph core / infrastructure` | `batch-ref` |
| `batch-shape` | `graph core / infrastructure` | `batch-shape` |
| `batch-source` | `graph core / infrastructure` | `batch-source` |
| `body-capped` | `vocabulary / declaration / fields` | `body-capped` |
| `body-source` | `vocabulary / declaration / fields` | `body-source` |
| `candidate-stale` | `graph core / infrastructure` | `candidate-stale` |
| `carriers-invalid` | `vocabulary / declaration / fields` | `carriers-invalid` |
| `catalog-incomplete` | `vocabulary / declaration / fields` | `catalog-incomplete` |
| `catalog-member` | `vocabulary / declaration / fields` | `catalog-member` |
| `checkout-holds-tree` | `graph core / infrastructure` | `checkout-holds-tree` |
| `claimed-elsewhere` | `core/holder` | `claimed-elsewhere` |
| `commit-off` | `graph core / infrastructure` | `commit-off` |
| `commit-step-cut` | `graph core / infrastructure` | `commit-step-cut` |
| `commit-step-failed` | `graph core / infrastructure` | `commit-step-failed` |
| `commit-step-missing` | `graph core / infrastructure` | `commit-step-missing` |
| `commit-unknown` | `core/reflection` | `commit-unknown` |
| `commit-unlanded` | `core/reflection` | `commit-unlanded` |
| `creation-contract` | `vocabulary / declaration / fields` | `creation-contract` |
| `creation-default-ambiguous` | `vocabulary / declaration / fields` | `creation-default-ambiguous` |
| `creation-default-invalid` | `vocabulary / declaration / fields` | `creation-default-invalid` |
| `creation-default-missing` | `vocabulary / declaration / fields` | `creation-default-missing` |
| `cross-project` | `graph core / infrastructure` | `cross-project` |
| `cross-project-parent` | `graph core / infrastructure` | `cross-project-parent` |
| `cursor-stale` | `graph core / infrastructure` | `cursor-stale` |
| `deleted` | `graph core / infrastructure` | `deleted` |
| `detached-checkout` | `graph core / infrastructure` | `detached-checkout` |
| `duplicate-identity` | `graph core / infrastructure` | `duplicate-identity` |
| `duplicate-name` | `graph core / infrastructure` | `duplicate-name` |
| `duplicate-root` | `graph core / infrastructure` | `duplicate-root` |
| `duplicate-source` | `graph core / infrastructure` | `duplicate-source` |
| `edge-shape` | `graph core / infrastructure` | `edge-shape` |
| `edge-undeclared` | `graph core / infrastructure` | `edge-undeclared` |
| `enforcement-stale` | `core/law; core/enforced` | `enforcement-stale` |
| `field-conflict` | `vocabulary / declaration / fields` | `field-conflict` |
| `field-invalid` | `vocabulary / declaration / fields` | `field-invalid` |
| `field-required` | `vocabulary / declaration / fields` | `field-required` |
| `field-target` | `vocabulary / declaration / fields` | `field-target` |
| `files` | `graph core / infrastructure` | `files` |
| `git-incomplete` | `graph core / infrastructure` | `git-incomplete` |
| `git-not-admitted` | `graph core / infrastructure` | `git-not-admitted` |
| `git-refused` | `graph core / infrastructure` | `git-refused` |
| `git-unavailable` | `graph core / infrastructure` | `git-unavailable` |
| `git-unreadable` | `graph core / infrastructure` | `git-unreadable` |
| `global-missing` | `graph core / infrastructure` | `global-missing` |
| `global-permanent` | `graph core / infrastructure` | `global-permanent` |
| `graph-commit` | `graph core / infrastructure` | `graph-commit` |
| `graph-pool` | `graph core / infrastructure` | `graph-pool` |
| `graph-required` | `graph core / infrastructure` | `graph-required` |
| `graph-unmerged` | `graph core / infrastructure` | `graph-unmerged` |
| `illegal-kind` | `graph core / infrastructure` | `illegal-kind` |
| `illegal-status` | `core/lifecycle` | `illegal-status` |
| `illegal-transition` | `core/lifecycle` | `illegal-transition` |
| `inspection-failed` | `core/law; core/enforced` | `inspection-failed` |
| `inspection-required` | `core/law; core/enforced` | `inspection-required` |
| `journal-unreadable` | `graph core / infrastructure` | `journal-unreadable` |
| `landing-busy` | `graph core / infrastructure` | `landing-busy` |
| `layer-forbidden` | `graph core / infrastructure` | `layer-forbidden` |
| `leaf` | `core/leaf` | `leaf` |
| `lines-held` | `graph core / infrastructure` | `lines-held` |
| `missing-root` | `graph core / infrastructure` | `missing-root` |
| `module-shape` | `core/module` | `module-shape` |
| `multiple-checkouts` | `graph core / infrastructure` | `multiple-checkouts` |
| `no-branch` | `graph core / infrastructure` | `no-branch` |
| `no-checkout` | `graph core / infrastructure` | `no-checkout` |
| `no-edge` | `graph core / infrastructure` | `no-edge` |
| `no-home` | `graph core / infrastructure` | `no-home` |
| `no-merge` | `graph core / infrastructure` | `no-merge` |
| `no-pool` | `graph core / infrastructure` | `no-pool` |
| `no-record` | `graph core / infrastructure` | `no-record` |
| `no-root` | `graph core / infrastructure` | `no-root` |
| `no-source` | `graph core / infrastructure` | `no-source` |
| `no-status` | `core/lifecycle` | `no-status` |
| `not-a-proposal` | `core/amendment` | `not-an-amendment` |
| `not-a-reflection` | `core/reflection` | `not-a-reflection` |
| `not-a-rule` | `core/law; core/enforced` | `not-law; not-enforced on enforcement` |
| `not-a-task` | `core/holder` | `no-holder; not-work in work brief` |
| `not-a-team-tree` | `graph core / infrastructure` | `not-a-team-tree` |
| `not-an-answer` | `core/reflection` | `not-an-answer` |
| `not-closable` | `core/lifecycle` | `not-closable` |
| `not-deleted` | `graph core / infrastructure` | `not-deleted` |
| `not-enforced` | `core/law; core/enforced` | `not-enforced` |
| `not-finished` | `core/lifecycle` | `not-finished` |
| `not-found` | `graph core / infrastructure` | `not-found` |
| `not-in-trash` | `graph core / infrastructure` | `not-in-trash` |
| `not-in-work` | `core/holder` | `not-held` |
| `not-measurable` | `graph core / infrastructure` | `not-measurable` |
| `not-projected` | `graph core / infrastructure` | `not-projected` |
| `not-served` | `graph core / infrastructure` | `not-served` |
| `not-superseded` | `graph core / infrastructure` | `not-superseded` |
| `open-children` | `core/lifecycle` | `open-children` |
| `operation-only` | `graph core / infrastructure` | `operation-only` |
| `out-of-scope` | `graph core / infrastructure` | `out-of-scope` |
| `pack-unused` | `core/law; core/enforced` | `pack-unused` |
| `parent-deleted` | `graph core / infrastructure` | `parent-deleted` |
| `path-outside-tree` | `graph core / infrastructure` | `path-outside-tree` |
| `place-mismatch` | `graph core / infrastructure` | `place-mismatch` |
| `project-name` | `graph core / infrastructure` | `project-name` |
| `project-not-empty` | `graph core / infrastructure` | `project-not-empty` |
| `project-required` | `graph core / infrastructure` | `project-required` |
| `project-retired` | `graph core / infrastructure` | `project-retired` |
| `project-root` | `graph core / infrastructure` | `project-root` |
| `proposal-shape` | `core/amendment` | `amendment-shape` |
| `query-shape` | `vocabulary / declaration / fields` | `query-shape` |
| `reach-empty` | `core/law; core/enforced` | `reach-empty` |
| `reason-required` | `core/amendment` | `reason-required` |
| `reflection-shape` | `graph core / infrastructure` | `reflection-shape` |
| `relative-root` | `graph core / infrastructure` | `relative-root` |
| `relocation-noop` | `graph core / infrastructure` | `relocation-noop` |
| `relocation-shape` | `graph core / infrastructure` | `relocation-shape` |
| `reserved-project` | `graph core / infrastructure` | `reserved-project` |
| `role-conflict` | `vocabulary / declaration / fields` | `role-conflict` |
| `root-unproven` | `graph core / infrastructure` | `root-unproven` |
| `rule-disabled` | `core/law; core/enforced` | `law-disabled` |
| `rule-escaped` | `core/law; core/enforced` | `law-escaped` |
| `rule-violated` | `core/law; core/enforced` | `law-violated` |
| `scope-outside-project` | `graph core / infrastructure` | `scope-outside-project` |
| `self-answer` | `core/amendment` | `self-answer` |
| `self-supersede` | `graph core / infrastructure` | `self-supersede` |
| `self-transfer` | `graph core / infrastructure` | `self-transfer` |
| `source-outside` | `graph core / infrastructure` | `source-outside` |
| `source-required` | `graph core / infrastructure` | `source-required` |
| `status-operation` | `core/lifecycle` | `status-operation` |
| `storage-unchanged` | `graph core / infrastructure` | `storage-unchanged` |
| `successor-superseded` | `graph core / infrastructure` | `successor-superseded` |
| `superseded` | `graph core / infrastructure` | `superseded` |
| `symbol-shape` | `graph core / infrastructure` | `symbol-shape` |
| `tag-declared` | `vocabulary / declaration / fields` | `tag-declared` |
| `tag-incoherent` | `vocabulary / declaration / fields` | `tag-incoherent` |
| `tag-undeclared` | `vocabulary / declaration / fields` | `tag-undeclared` |
| `target-holds-tree` | `graph core / infrastructure` | `target-holds-tree` |
| `team-tree` | `graph core / infrastructure` | `team-tree` |
| `tree-cycle` | `graph core / infrastructure` | `tree-cycle` |
| `tree-empty` | `graph core / infrastructure` | `tree-empty` |
| `tree-mid-merge` | `graph core / infrastructure` | `tree-mid-merge` |
| `tree-missing` | `graph core / infrastructure` | `tree-missing` |
| `tree-not-measured` | `graph core / infrastructure` | `tree-not-measured` |
| `tree-unreadable` | `graph core / infrastructure` | `tree-unreadable` |
| `trigger-unknown` | `core/law; core/enforced` | `trigger-unknown` |
| `unknown-catalog` | `graph core / infrastructure` | `unknown-catalog` |
| `unknown-project` | `graph core / infrastructure` | `unknown-project` |
| `verdict-standing` | `core/amendment` | `verdict-standing` |
| `vocabulary-newer` | `vocabulary / declaration / fields` | `vocabulary-newer` |
| `vocabulary-older` | `vocabulary / declaration / fields` | `vocabulary-older` |
| `wait-cycle` | `graph core / infrastructure` | `wait-cycle` |
| `walk-cut` | `graph core / infrastructure` | `walk-cut` |

`proposal-shape` merges into `amendment-shape`: both name the wrong form of a deferred change. `not-a-rule` on enforcement checks `core/enforced`; there the refusal becomes `not-enforced`, and on law switching — `not-law`. The journal keeps the `claim`, `done`, `close` acts in its own words. The graph step changes only structural references to operation ids in enforcement and names recorded in the journal payload. Grants live in `thread_mandate.approves` and the `agent.approves` setting; `delegation` is a boolean spawn switch. The same migration translates `native_thread.profile.overlay.tools`, from which the thread's current tool catalog is assembled; the frozen prompt stays the source text. The published run context carries a separate `contextChange.evidence.tools` list: the thread-journal form step declared by the graph translates it on read, without an SQL pass over history. Otherwise the restored list would replace the translated profile and drop new names from admission.
