CREATE TABLE `worktree_merge` (
	`dir` text PRIMARY KEY,
	`tip` text NOT NULL,
	`base` text NOT NULL,
	`base_time` integer NOT NULL,
	`driver_revision` text NOT NULL,
	`fingerprint` text NOT NULL,
	`taken_at` integer NOT NULL,
	`merged` text,
	`held` integer NOT NULL,
	`problem` text
);
--> statement-breakpoint
CREATE TABLE `worktree_state` (
	`root_id` text PRIMARY KEY,
	`path` text NOT NULL,
	`head` text,
	`index_stamp` text NOT NULL,
	`base` text,
	`taken_at` integer NOT NULL,
	`state` text NOT NULL,
	CONSTRAINT `fk_worktree_state_root_id_file_root_root_id_fk` FOREIGN KEY (`root_id`) REFERENCES `file_root`(`root_id`) ON DELETE CASCADE
);
