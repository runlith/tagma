INSERT INTO `setting` (`scope`, `project_id`, `key`, `value`, `declined`, `session_id`, `updated_at`)
SELECT `scope`, `project_id`, 'checkout.untrackedCache', `value`, `declined`, `session_id`, `updated_at`
FROM `setting` WHERE `key` = 'checkout.fastStatus';
--> statement-breakpoint
INSERT INTO `setting` (`scope`, `project_id`, `key`, `value`, `declined`, `session_id`, `updated_at`)
SELECT `scope`, `project_id`, 'checkout.fsmonitor', `value`, `declined`, `session_id`, `updated_at`
FROM `setting` WHERE `key` = 'checkout.fastStatus';
--> statement-breakpoint
DELETE FROM `setting` WHERE `key` = 'checkout.fastStatus';
