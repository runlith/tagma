CREATE TABLE `vendor_turn` (
	`thread_id` text NOT NULL,
	`run_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`address` text,
	CONSTRAINT `vendor_turn_pk` PRIMARY KEY(`thread_id`, `run_id`),
	CONSTRAINT `fk_vendor_turn_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `vendor_turn` (`thread_id`, `run_id`, `ordinal`, `address`) SELECT `thread_id`, `turn`, `ordinal`, `prompt` FROM `protocol_turn`;
--> statement-breakpoint
DROP TABLE `protocol_turn`;
--> statement-breakpoint
CREATE INDEX `vendor_turn_order` ON `vendor_turn` (`thread_id`,`ordinal`);
--> statement-breakpoint
CREATE TABLE `vendor_session` (
	`thread_id` text PRIMARY KEY,
	`account` text,
	`replaced` text,
	CONSTRAINT `fk_vendor_session_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
