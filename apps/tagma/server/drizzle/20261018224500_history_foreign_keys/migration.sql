CREATE INDEX `command_environment_use_idx` ON `command` (`environment_use_id`);
--> statement-breakpoint
CREATE INDEX `command_window_project_idx` ON `command_window` (`project_id`);
--> statement-breakpoint
CREATE INDEX `event_session_idx` ON `event` (`session_id`);
--> statement-breakpoint
CREATE INDEX `landing_intent_project_idx` ON `landing_intent` (`project_id`);
--> statement-breakpoint
CREATE INDEX `remeasure_landing_project_idx` ON `remeasure_landing` (`project_id`);
--> statement-breakpoint
CREATE INDEX `target_snapshot_run_idx` ON `target_snapshot` (`run_id`);
--> statement-breakpoint
CREATE INDEX `terminal_intent_environment_use_idx` ON `terminal_intent` (`environment_use_id`);
--> statement-breakpoint
CREATE INDEX `thread_cache_observation_thread_idx` ON `thread_cache_observation` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `touch_session_idx` ON `touch` (`session_id`);
--> statement-breakpoint
CREATE INDEX `workspace_change_project_idx` ON `workspace_change` (`project_id`);
--> statement-breakpoint
CREATE INDEX `worktree_operation_root_idx` ON `worktree_operation` (`root_id`);
