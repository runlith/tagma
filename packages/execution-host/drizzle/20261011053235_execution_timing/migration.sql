CREATE TABLE `execution_pace` (
	`execution_id` text PRIMARY KEY,
	`initial` text NOT NULL,
	`target` text NOT NULL,
	CONSTRAINT `fk_execution_pace_execution_id_execution_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `execution`(`execution_id`)
);
--> statement-breakpoint
CREATE TABLE `execution_rules` (
	`execution_id` text PRIMARY KEY,
	`bound` text NOT NULL,
	CONSTRAINT `fk_execution_rules_execution_id_execution_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `execution`(`execution_id`)
);
--> statement-breakpoint
ALTER TABLE `call` ADD `timing` text;