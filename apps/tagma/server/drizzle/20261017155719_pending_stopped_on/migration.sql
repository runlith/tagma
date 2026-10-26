ALTER TABLE `worktree_pending_merge` ADD `stopped_on` text;--> statement-breakpoint
ALTER TABLE `worktree_pending_merge` DROP COLUMN `stopped_base`;--> statement-breakpoint
ALTER TABLE `worktree_pending_merge` DROP COLUMN `stopped_tip`;