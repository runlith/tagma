CREATE TABLE `__new_project` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`repo_key` text NOT NULL,
	`root_path` text NOT NULL,
	`strict_provenance` integer DEFAULT false NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`global` integer DEFAULT false NOT NULL,
	`storage` text DEFAULT 'stealth' NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_project`(`id`, `name`, `repo_key`, `root_path`, `strict_provenance`, `private`, `created_at`, `global`, `storage`, `removed_at`) SELECT `id`, `name`, `repo_key`, `root_path`, `strict_provenance`, `private`, `created_at`, `global`, `storage`, `removed_at` FROM `project`;
--> statement-breakpoint
INSERT INTO `__new_project`(`id`, `name`, `repo_key`, `root_path`, `created_at`) SELECT `seq`, '', '', '', 0 FROM `sqlite_sequence` WHERE `name` = 'project' AND `seq` > (SELECT coalesce(max(`id`), 0) FROM `__new_project`);
--> statement-breakpoint
DELETE FROM `__new_project` WHERE `name` = '';
--> statement-breakpoint
DROP TABLE `project`;
--> statement-breakpoint
ALTER TABLE `__new_project` RENAME TO `project`;
--> statement-breakpoint
CREATE UNIQUE INDEX `project_identity_idx` ON `project` (`repo_key`);
