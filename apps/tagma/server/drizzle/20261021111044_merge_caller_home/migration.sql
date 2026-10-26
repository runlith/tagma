ALTER TABLE `merge_request` ADD `caller_project_id` integer;--> statement-breakpoint
ALTER TABLE `worktree_pending_merge` ADD `caller_project_id` integer;