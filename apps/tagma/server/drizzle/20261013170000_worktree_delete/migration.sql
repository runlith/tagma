DELETE FROM `worktree` WHERE `archived_at` IS NOT NULL;
--> statement-breakpoint
DROP INDEX `worktree_project_idx`;
--> statement-breakpoint
CREATE INDEX `worktree_project_idx` ON `worktree` (`project_id`);
--> statement-breakpoint
ALTER TABLE `worktree` DROP COLUMN `archived_at`;
--> statement-breakpoint
DROP TABLE `worktree_archive_intent`;
--> statement-breakpoint
CREATE TABLE `worktree_deletion` (
	`key` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`root_id` text NOT NULL,
	`phase` text NOT NULL,
	`paths` text NOT NULL,
	`holders` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_deletion_root_idx` ON `worktree_deletion` (`root_id`);
--> statement-breakpoint
CREATE INDEX `worktree_deletion_at_idx` ON `worktree_deletion` (`at`,`key`);
--> statement-breakpoint
UPDATE `worktree_pending_merge` SET `after` = 'delete' WHERE `after` = 'archive';
--> statement-breakpoint
UPDATE `merge_request` SET `after` = 'delete' WHERE `after` = 'archive';
--> statement-breakpoint
UPDATE `merge_receipt` SET `after_act` = 'delete' WHERE `after_act` = 'archive';
