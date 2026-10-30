CREATE TABLE `group_member` (
	`project_id` integer PRIMARY KEY,
	`group_id` integer NOT NULL,
	`ord` integer NOT NULL,
	CONSTRAINT `fk_group_member_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_group_member_group_id_project_id_fk` FOREIGN KEY (`group_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `project` ADD `kind` text DEFAULT 'folder' NOT NULL;--> statement-breakpoint
UPDATE `project` SET `kind` = 'global' WHERE `global` = 1;--> statement-breakpoint
CREATE INDEX `group_member_group_idx` ON `group_member` (`group_id`,`ord`);