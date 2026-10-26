PRAGMA legacy_alter_table = ON;--> statement-breakpoint
ALTER TABLE `thread_run_transition` RENAME TO `retired_run_transition`;--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;--> statement-breakpoint
CREATE TABLE `thread_run_receipt` (
	`run_id` text PRIMARY KEY,
	`seq` integer NOT NULL,
	`request_digest` text NOT NULL,
	`result` text NOT NULL,
	CONSTRAINT `fk_thread_run_receipt_run_id_thread_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `thread_run`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
INSERT INTO `thread_run_receipt` (`run_id`, `seq`, `request_digest`, `result`)
SELECT `t`.`run_id`, `t`.`seq`, `t`.`request_digest`, `t`.`result`
FROM `thread_run` AS `r` CROSS JOIN `retired_run_transition` AS `t`
WHERE `r`.`status` = 'running' AND `t`.`run_id` = `r`.`id` AND `t`.`seq` = `r`.`applied_seq`;--> statement-breakpoint
CREATE TRIGGER `thread_run_receipt_end` AFTER UPDATE OF `status` ON `thread_run`
WHEN NEW.`status` <> 'running'
BEGIN
	DELETE FROM `thread_run_receipt` WHERE `run_id` = NEW.`id`;
END;
