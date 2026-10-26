CREATE TABLE `far_edge` (
	`from_id` integer NOT NULL,
	`kind` text NOT NULL,
	`graph` text NOT NULL,
	`uuid` text NOT NULL,
	`label` text NOT NULL,
	`created_by_session_id` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `far_edge_pk` PRIMARY KEY(`from_id`, `kind`, `graph`, `uuid`),
	CONSTRAINT `fk_far_edge_from_id_block_id_fk` FOREIGN KEY (`from_id`) REFERENCES `block`(`id`),
	CONSTRAINT `fk_far_edge_created_by_session_id_session_id_fk` FOREIGN KEY (`created_by_session_id`) REFERENCES `session`(`id`)
);
--> statement-breakpoint
CREATE INDEX `far_edge_target_idx` ON `far_edge` (`graph`,`uuid`,`kind`);