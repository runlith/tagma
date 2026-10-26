PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stop_intent` (
	`execution_id` text NOT NULL,
	`installation` text NOT NULL,
	`operation_id` text NOT NULL,
	`incarnation` integer NOT NULL,
	`cause` text NOT NULL,
	`policy` text NOT NULL,
	`coverage` text NOT NULL,
	`requested` text NOT NULL,
	`joined` integer NOT NULL,
	`requested_at` integer NOT NULL,
	CONSTRAINT `stop_intent_pk` PRIMARY KEY(`execution_id`, `installation`, `operation_id`),
	CONSTRAINT `fk_stop_intent_execution_id_execution_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `execution`(`execution_id`)
);
--> statement-breakpoint
INSERT INTO `__new_stop_intent`(`execution_id`, `installation`, `operation_id`, `incarnation`, `cause`, `policy`, `coverage`, `requested`, `joined`, `requested_at`) SELECT `execution_id`, `installation`, `operation_id`, `incarnation`, `cause`, `policy`, `coverage`, 'destroy', 0, `requested_at` FROM `stop_intent`;--> statement-breakpoint
DROP TABLE `stop_intent`;--> statement-breakpoint
ALTER TABLE `__new_stop_intent` RENAME TO `stop_intent`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `stop_intent_execution_idx` ON `stop_intent` (`execution_id`);
