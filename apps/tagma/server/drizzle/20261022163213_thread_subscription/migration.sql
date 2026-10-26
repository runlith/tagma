CREATE TABLE `thread_subscription` (
	`subscriber_id` text NOT NULL,
	`target_id` text NOT NULL,
	`wakes` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `thread_subscription_pk` PRIMARY KEY(`subscriber_id`, `target_id`),
	CONSTRAINT `fk_thread_subscription_subscriber_id_thread_id_fk` FOREIGN KEY (`subscriber_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_subscription_target_id_thread_id_fk` FOREIGN KEY (`target_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `thread_subscription_target_idx` ON `thread_subscription` (`target_id`);