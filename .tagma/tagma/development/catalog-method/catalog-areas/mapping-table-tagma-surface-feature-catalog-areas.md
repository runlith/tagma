---
id: 01a14b9b-d842-7f67-8b91-c95e1310e014
title: "Mapping table: Tagma surface → feature-catalog areas"
ord: 1
---
Every Tagma surface unit stands in exactly one catalog area; the areas and their boundaries are described in the parent block. Area codes: A1 agents and collaboration, A2 conversation and attention, A3 knowledge graph, A4 project and its law, A5 code, A6 executions, A7 models and providers, A8 speech, A9 web, A10 extensions, A11 Tagma on the machine, A12 shell and utilities.

## Operations (382)

**A1 (86)**
- external-harnesses (14): adopt_harness_session, call_hosted_tool, guide_harness, judge_harness_call, open_hosted_turn, read_harness_screen, read_hosted_agent, read_hosted_history, read_hosted_tools, read_installation_status, record_harness_outcome, report_harness_event, set_thread_transport, speak_harness
- native-harness (17): compact_thread, control_call, list_workflow_runs, list_workflows, read_calls, read_compaction_choices, read_compaction_summarizers, read_model_defaults, read_model_favorites, read_thread_agent, refresh_thread_instructions, save_agent, set_model_defaults, set_model_favorites, set_thread_model, start_workflow, wait_call
- threads (55): answer_approval, answer_question, archive_thread, archive_threads, branch_thread, continue_agent, continue_thread, create_thread, create_thread_folder, delete_thread, delete_thread_folder, detach_thread, file_threads, generate_thread_title, interrupt_agent, list_agents, list_thread_folders, list_thread_types, list_thread_window, list_threads, locate_thread, move_thread, move_thread_folder, pin_thread, queue_turn, read_agent, read_agent_library, read_endings, read_operator_notes, read_rewind, read_rewind_points, read_statuses, read_thread, read_thread_record, redeliver_ending, read_attention, restore_thread, rewind_thread, search_threads, send_message, send_task, set_thread_approver, set_thread_approves, set_thread_authority, set_thread_delegation, set_thread_operator_notice, set_thread_title, spawn_agent, start_turn, steer_turn, stop_agent, stop_run, switch_operator_notes, unqueue_turn, write_operator_note

**A2 (20)**
- native-harness (5): read_thread_composition, read_thread_entries, read_thread_entry, read_thread_held, read_thread_snapshot
- notify (3): answer_notification, dismiss_notification, send_notification
- push (3): read_push_status, subscribe_push, unsubscribe_push
- remote (4): create_pairing, list_devices, read_remote_access, revoke_device
- threads (5): generate_thread_recap, mark_thread_seen, read_attention, read_thread_rollout, repair_thread_rollout

**A3 (50)**
- graph (48): accept_amendment, anchor_block, answer_reflection, apply_batch, claim_block, close_block, create_block, delete_block, edit_block, finish_block, link_blocks, list_root_blocks, list_sessions, list_trash, query_blocks, read_amendments, read_block, read_block_diff, read_block_log, read_brief, read_edges, read_events, read_gauges, read_journal, read_journal_vocabulary, read_owners, read_path_exists, read_refs, read_review_brief, read_tags, read_titles, read_tree, read_vocabulary, read_zone, ready_work, reanchor_path, reject_amendment, release_block, restore_block, revise_amendment, search_blocks, supersede_block, unanchor_block, unanswer_reflection, unlink_blocks, unsupersede_block, update_block, uphold_amendment
- reflections (2): file_reflection, read_reflections

**A4 (25)**
- change-record (1): strip_comments
- enforcement (6): check_rules, enforce_rule, read_enforcement, read_inspections, record_commit, set_module
- graph (17): add_project, list_branches, list_projects, read_graph_recovery, read_law, read_project, remove_project, resolve_graph_conflict, rewrite_graph_files, session_start, set_rule_delivery, set_rule_enabled, set_project_root, set_project_storage, sync_graph, touch_path, update_project
- threads (1): start_graph_recovery

**A5 (45)**
- change-record (4): read_authorship, read_changes, record_write, revert_lines
- checkout-files (10): create_entry, find_files, move_entries, place_path, read_directory, restore_entries, reveal_entry, trash_entries, write_document, write_file
- commit-steps (1): read_commit_steps
- landing (7): cancel_worktree_merge, check_worktree_merge, commit_checkout, merge_worktree, open_worktree_pr, pull_checkout, submit_work
- threads (1): update_worktree
- workspace (10): abort_checkout, discard_checkout, fetch_checkout, read_checkout, read_checkout_history, read_commit, read_repositories, stage_checkout, unstage_checkout
- worktrees (12): abandon_worktree, adopt_worktree, clean_up_worktrees, create_worktree, delete_worktree, list_worktree_cleanup, list_worktrees, prepare_worktree, prepare_worktree_recovery, read_worktree_operation, reconcile_worktree, rename_worktree

**A6 (41)**
- executions (34): change_command_limit, close_terminal_lane, end_machine_process, end_residual, end_residuals, input_terminal, interrupt_terminal, open_terminal_lane, read_command, read_command_bytes, read_command_feed, read_command_rules, read_commands, read_machine_load, read_output, read_terminal, read_terminal_bytes, read_terminal_operation, read_terminal_ports, read_terminal_processes, read_terminal_screen, read_terminals, remove_command_rule, resize_terminal, signal_terminal, start_terminal, stop_command, stop_terminal, take_over_terminal, transfer_terminal, wait_command, wait_terminal, write_command_rule, write_terminal
- sandbox (7): build_prepared_tree, import_output, prepare_sandbox, read_prepared_tree, read_sandbox, read_sandbox, release_prepared_tree, release_sandbox

**A7 (24)**
- providers (24): begin_sign_in, complete_sign_in, disable_adapter, discover_adapter_models, enable_adapter, install_adapter, list_accounts, list_console_keys, read_adapter_settings, read_adapters, read_cache_lifetimes, read_provider_token, read_sign_in, refresh_accounts, remove_account, remove_adapter, remove_adapter_instance, remove_console_key, rename_account, save_adapter_instance, save_console_key, select_account_mode, set_default_account, update_adapter

**A8 (22)**
- speech (6): finish_recognition, install_speech_model, remove_speech_model, speak_text, speech_status, stop_speaking

**A9 (21)**
- browser (21): act_on_page, answer_page_dialog, capture_page, clear_profile, close_page, create_profile, delete_profile, emulate_page, evaluate_in_page, import_cookies, list_cookie_sources, list_pages, list_profiles, navigate_page, open_page, read_page_console, read_page_downloads, read_page_network, snapshot_page, update_profile, wait_for_page

**A10 (26)**
- artifacts (1): list_artifacts
- mcp (7): add_mcp_server, call_mcp_app_tool, enable_mcp_server, open_mcp_app, read_mcp_resource, read_mcp_servers, remove_mcp_server
- native-harness (3): read_agent_skills, read_workspace_sources, reload_workspace_sources
- secrets (3): read_secrets, remove_secret, set_secret
- tagma-apps (5): enable_app, install_app, read_app_schema, read_apps, uninstall_app
- schedule (1): read_schedules
- threads (2): pin_view, unpin_view
- views (4): call_app_tool, read_app_resource, read_view_storage, write_view_storage

**A11 (12)**
- access (4): read_access, refresh_access, sign_in, sign_out
- installation (8): install_next, place_command, prepare_downgrade, read_machine_state, report_restart_window, restart_server, stop_installing, vacuum_database

**A12 (10)**
- invocation (1): read_operations
- performance (6): capture_heap_snapshot, capture_memory_reading, capture_performance_profile, read_host_performance, read_performance, read_watches
- settings (3): read_settings, write_setting, write_setting_layer

## Settings (135)

- **A1 (24):** agent.approvalMode, agent.approves, agent.compactionOverrides, agent.compactionStrategy, agent.compactionSummarizerRule, agent.compactionSummarizers, agent.compactionTrigger, agent.default, agent.delegation, agent.keepWarm, agent.keepWarmPings, agent.modelGuidance, agent.offered, agent.operatorNotice, agent.subAgentDepth, agent.takeover, agent.worktrees, threads.autoTitle, threads.harnessProfile, threads.harnessTitle, threads.harnessTransport, threads.terminalChat, threads.titleCharacters, threads.titleModel
- **A2 (7):** activity.bodiesMaxBytes, activity.keepHours, agent.startShare, agent.toolOutputShare, remote.enabled, threads.idleProjectionDays, threads.recap
- **A3 (1):** graph.catalogs
- **A4 (6):** enforcement.programs, graph.commit, orientation.mapBudget, rules.global.disabled, rules.global.enabled, writing.comments
- **A5 (10):** agent.autoCommit, agent.checkout, checkout.fsmonitor, checkout.untrackedCache, editor.autoSave, editor.autoSaveDelay, worktrees.branchPrefix, worktrees.folder, worktrees.setupCopy, worktrees.setupRun
- **A6 (44):** agent.checkoutWorld, agent.commandDescription, host.memoryShare, power.agentWork, power.keepAwake and 39 `terminal.*` keys: activePaneOpacity, allowOsc52Clipboard, backgroundOpacity, clipboardOnSelect, colorOverrides, cursorBlink, cursorOpacity, cursorStyle, dividerColorDark, dividerColorLight, dividerThicknessPx, fastScrollSensitivity, focusFollowsMouse, fontFamily, fontSize, fontWeight, fontWeightBold, gpuAcceleration, importedFromOrca, inactivePaneOpacity, lastGrid, ligatures, lineHeight, macOptionAsAlt, mouseHideWhileTyping, opacityTransitionMs, paddingX, paddingY, placeLayouts, rightClickToPaste, scrollSensitivity, scrollbackRows, shortcutPolicy, skipCloseConfirm, themeDark, themeLight, tuiScrollSensitivity, useSeparateLightTheme, wordSeparator
- **A7 (0)**
- **A8 (10):** speech.dictation.global, speech.dictation.globalKey, speech.dictation.key, speech.dictation.recognizer, speech.languages, speech.microphone, speech.recognizer, speech.segmenter, speech.tuning, speech.voice
- **A9 (4):** agent.web, browser.agentProfile, browser.openLinks, browser.userProfile
- **A10 (12):** agent.contextFiles.enabled, agent.contextFiles.names, apps.enabled, apps.installed, mcp.servers, skills.directories.global, skills.directories.project, skills.disabled, skills.global.enabled, skills.own.enabled, skills.project.enabled, skills.rescan
- **A11 (2):** access.cloud, release.feed (release build only)
- **A12 (7):** appearance.loadInStatusBar, telemetry.keepOneTraceIn, telemetry.maxPendingBytes, telemetry.maxStoredBytes, telemetry.metricsIntervalMs, telemetry.spanFloorMicros, telemetry.vitalsIntervalMs

## CLI `tagma` (47 top-level verbs)

- **A1 (14):** ask, reply, steer, stop, continue, compact, unqueue (threads/cli/turnVerbs), threads, thread (threads/cli/threadVerbs), workflow (native-harness), hook, review, harness-run (external-harnesses), mcp-serve (cli)
- **A2 (1):** activity (threads/cli/threadVerbs)
- **A3 (3):** trash (graph/cli/blocks), edges, sessions (graph/cli/listings)
- **A4 (9):** project (projects), law, disable, enable, files (graph/cli), check, merge-driver (enforcement), install, upgrade (installation/cli/setup)
- **A6 (3):** command, execution-host (executions), sandbox
- **A7 (2):** auth, adapter (providers)
- **A10 (1):** artifacts
- **A11 (13):** serve, db (composition/cli), restart, status, switch, quit (installation/cli/server), transfer, web, desktop (installation), build, update (checkout-builds), release, install-from (release-channel, release build only)
- **A12 (1):** op (cli)

## Native-agent tools outside the operation catalog (20)

The agent's remaining tools are operations and stand above in their areas.
- **A1 (5):** compact_agent, rewind_agent, set_agent_model, read_models, ask_user
- **A2 (3):** tool_search, read_tool_output, held_resources
- **A5 (8):** read, write, edit, glob, grep, ls, delete, rename
- **A6 (1):** bash
- **A9 (2):** webfetch, websearch
- **A10 (1):** load_skill

## Application `apps/tagma/app/src/lib`

**`features` folders (26)**
- A1: threads — except the parts below
- A2: threads — the chat surface (`native/` feed and composer: Conversation, Panel, DraftShelf, DraftStore, DraftFiles, ThreadUploads, PromptStore, PendingStore, ChatMarkdown, ContextRing, Contributions, RecapCard, RecapAttemptCard, RunEnding, StartCard, Transcript*, Tool* without ToolBlockDiff, `*.feed` recap, composition, signals, calls, `*.composer` draft, context, lead; `thread/` ThreadFeed, ThreadComposition, ThreadContext, ThreadRecap, ThreadViews; `presence/`; Held, Life, Peek, threadPeek, ChatHold, ThreadChats, Attention), activity, devices, shell
- A3: graph — except the A4 parts; graph `graphTools.feed`, ToolBlockDiff, BlockCard, BlockRefText cards from threads
- A4: rules; from graph — GraphFilesSection, WritingSection, Recovery, RecoveryBanner
- A5: checkout, worktrees, opening; from threads — bash.feed, CommandActs, CommandMark, CommandStatus, CommandToolRow, LoadBadge
- A6: executions, power; from threads — quota.feed
- A7: providers; from threads — dictation.composer
- A8: speech; from threads — browserTools.feed
- A9: browser; from threads — mcpApps.feed, tagmaAppViews.feed, pins.feed, skills.composer, SkillCatalog, SkillsSection
- A10: mcp, tagma-apps, views, secrets, pages; from threads — pins.feed
- A11: access
- A12: settings, projects, workspace, palette, notices, telemetry

**Shell (`lib/app`, `lib/shared`, `lib/wire`)**
- A2: app/attention, app/mobile, admission (Admitted, Refused — remote-device admission)
- A1: chrome/AgentLibraryItem
- A4: chrome/NewProjectDialog, NewProjectCatalogs, ProjectCreation
- A5: chrome/WorktreeCard, WorktreeSwitcher
- A6: chrome/LoadButton, LoadChart, LoadPanel, LoadRow, LoadSpark, AwakeControl, PaceControl
- A7: chrome/UsageMeters
- A12: the rest of chrome (Shell, TopBar, NavigationRail, StatusBar, AppMenu, CommandPalette, BackForward, Settings, RestartNotice, FaultsButton, WireState, LiveChip, Standing), app/panes, app/keys, app/shell, Root, runtime, overlays, shared, wire

**Page routes (15)**
- A2: `[project]/chat/[[id]]`, `pair`
- A3: `[project]/graph/[[id]]`, `[project]/journal/[[id]]`, `[project]/b/[id]`
- A4: `[project]/rules`
- A5: `[project]/checkout`
- A8: `_desktop/dictation`
- A9: `[project]/w/[[page]]`
- A10: `[project]/p/[app]/[view]`, `_desktop/view/[project]/[app]/[view]`
- A12: `/`, `[project]`, `settings`

## Server modules `apps/tagma/server/src` (47)

- A1: threads (except the parts named below), native-harness (except evidence, transcript, tools, skills, inputs), external-harnesses, thread-record
- A2: threads/recap, attention and rollout; native-harness evidence, transcript, tools (output storage, deferred tools), resources; notify, push, remote, activity
- A3: graph (except the A4 parts), reflections, catalogs
- A4: graph/orientation, tree, storage, serving, project and law operations; enforcement, projects; change-record — comment stripping
- A5: workspace, landing, change-record (except comment stripping), checkout-files, worktrees, commit-steps
- A6: executions, sandbox, power, mac-user-environment
- A7: providers
- A8: speech
- A9: browser, managed-browser, desktop-browser
- A10: mcp, tagma-apps, views, secrets, artifacts, schedule; native-harness skills and inputs
- A11: installation, access, release-channel, checkout-builds, mac-applications; composition/cli (serve, db) and composition/cut (release, developer only)
- A12: settings, performance, invocation, http, socket, cli
- substrate with no surface of its own: platform, composition (server assembly)

## Packages `packages` (76)

- A1 (3): agent, acp, agent-zod
- A2 (4): chat-ui, activity, markdown, scroll-follow
- A3 (3): builtin-catalog, markdown-editor, search-text
- A4 (2): code-facts, source-comments
- A5 (7): git, files, github, code-editor, highlight, ripgrep, agent-tools (file tools; bash from it is A6, webfetch and websearch are A9)
- A6 (3): execution-host, executions, held
- A7 (12): llm, credential-file, tagma, adapter-anthropic, adapter-deepseek, adapter-devin, adapter-muse, adapter-openai, adapter-openai-compatible, adapter-opencode-go, adapter-stepfun, adapter-xai
- A8 (9): speech, speech-openai, speech-soniox, speech-whisper, audio, audio-darwin, audio-file, echo, desktop-input
- A9 (2): cdp, browser-cookies
- A10 (2): mcp, agent-sources
- A11 (5): desktop-host, window-behavior, bundle, codesign, visual-identity-node
- A12 (8): performance, layer, query, primitives, ui-primitives, i18n, error-boundary, seam
- substrate (5): utils, sqlite-process, ndjson-rpc, file-lock, paging
- development and tests, outside the catalog (5): dev-runner, effect-test, testing, tsconfig, vite-browser-guard

## Other `apps/tagma` applications

- desktop: A11 — windows, release, exit and stop, wait page, bridge; A8 — Dictation.ts (pill and global key); A9 — src/browser (built-in browser host); A10 — viewWindows.ts, viewWindowUrl.ts (app-view windows)
- inspection: A4 — 8 builtin inspections (call-services, loads, modules, names, platforms, reexports, size, swallowed-failures) in the js, effect, and architecture packs and runners of external programs (ast-grep, eslint, files, oxlint, ruff, sarif, semgrep)

## Outside the catalog

Test files and test settings keys (`test.share`, `test.userOnly`, `traces.maxBytes`).
