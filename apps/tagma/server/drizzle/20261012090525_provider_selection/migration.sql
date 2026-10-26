PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_model_preference` (
	`principal_id` text PRIMARY KEY,
	`provider` text,
	`model` text,
	`reasoning` text,
	`default_switches` text DEFAULT '{}' NOT NULL,
	`favorite_models` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "model_preference_selection" CHECK("model" is null or "provider" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_model_preference`(`principal_id`, `provider`, `model`, `reasoning`, `default_switches`, `favorite_models`, `updated_at`) SELECT `principal_id`, `provider`, `model`, `reasoning`, `default_switches`, `favorite_models`, `updated_at` FROM `model_preference`;--> statement-breakpoint
DROP TABLE `model_preference`;--> statement-breakpoint
ALTER TABLE `__new_model_preference` RENAME TO `model_preference`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
PRAGMA legacy_alter_table = ON;--> statement-breakpoint
CREATE TABLE `__new_native_thread` (
	`id` text PRIMARY KEY,
	`cache_group` text NOT NULL,
	`profile` text,
	`pending_interaction` text,
	`account` text,
	`provider` text NOT NULL,
	`model` text,
	`reasoning` text,
	`switches` text DEFAULT '{}' NOT NULL,
	`transport` text DEFAULT '{"adapter":"native","profile":null,"agent":null}' NOT NULL,
	`capabilities` text DEFAULT '{"messaging":true,"judgedModel":true,"steer":"step","withdraw":true,"history":"journal","compaction":"core","modelMove":"live","openings":"core","pictures":true,"web":"none","law":"every-call","touch":"reads-and-writes","authorship":"recorded","callEnvelopeMs":1200000,"screen":false,"continue":true}' NOT NULL,
	`call_envelope_ms` integer GENERATED ALWAYS AS (json_extract(capabilities, '$.callEnvelopeMs')) VIRTUAL,
	`system_prompt` text,
	`pending_system_prompt` text,
	`failure_reason` text,
	`context_reading` text,
	`context_event_id` integer DEFAULT 0 NOT NULL,
	`world_state_snapshot` text DEFAULT '{}' NOT NULL,
	`world_state_checkpoint_id` text,
	`context_runs` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_native_thread_id_thread_id_fk` FOREIGN KEY (`id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_native_thread`(`id`, `cache_group`, `profile`, `pending_interaction`, `account`, `provider`, `model`, `reasoning`, `switches`, `transport`, `capabilities`, `system_prompt`, `pending_system_prompt`, `failure_reason`, `context_reading`, `context_event_id`, `world_state_snapshot`, `world_state_checkpoint_id`, `context_runs`, `updated_at`) SELECT `id`, `cache_group`, `profile`, `pending_interaction`, `account`, `provider`, `model`, `reasoning`, `switches`, `transport`, `capabilities`, `system_prompt`, `pending_system_prompt`, `failure_reason`, `context_reading`, `context_event_id`, `world_state_snapshot`, `world_state_checkpoint_id`, `context_runs`, `updated_at` FROM `native_thread`;--> statement-breakpoint
DROP TABLE `native_thread`;--> statement-breakpoint
ALTER TABLE `__new_native_thread` RENAME TO `native_thread`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `native_thread_updated_idx` ON `native_thread` (`updated_at`);--> statement-breakpoint
CREATE INDEX `native_thread_asking_idx` ON `native_thread` (`id`) WHERE json_extract("native_thread"."pending_interaction", '$.action') is not null;--> statement-breakpoint
CREATE TRIGGER `native_thread_rev_update` AFTER UPDATE OF `cache_group`, `profile`, `account`, `provider`, `model`, `reasoning`, `switches`, `system_prompt`, `pending_interaction`, `pending_system_prompt`, `failure_reason`, `context_reading`, `context_event_id`, `world_state_snapshot`, `world_state_checkpoint_id` ON `native_thread` WHEN OLD.`cache_group` IS NOT NEW.`cache_group` OR OLD.`profile` IS NOT NEW.`profile` OR OLD.`account` IS NOT NEW.`account` OR OLD.`provider` IS NOT NEW.`provider` OR OLD.`model` IS NOT NEW.`model` OR OLD.`reasoning` IS NOT NEW.`reasoning` OR OLD.`switches` IS NOT NEW.`switches` OR OLD.`system_prompt` IS NOT NEW.`system_prompt` OR OLD.`pending_interaction` IS NOT NEW.`pending_interaction` OR OLD.`pending_system_prompt` IS NOT NEW.`pending_system_prompt` OR OLD.`failure_reason` IS NOT NEW.`failure_reason` OR OLD.`context_reading` IS NOT NEW.`context_reading` OR OLD.`context_event_id` IS NOT NEW.`context_event_id` OR OLD.`world_state_snapshot` IS NOT NEW.`world_state_snapshot` OR OLD.`world_state_checkpoint_id` IS NOT NEW.`world_state_checkpoint_id` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`, `inherit_rev`) VALUES (NEW.`id`, 1, CASE WHEN OLD.`cache_group` IS NOT NEW.`cache_group` OR OLD.`profile` IS NOT NEW.`profile` OR OLD.`account` IS NOT NEW.`account` OR OLD.`provider` IS NOT NEW.`provider` OR OLD.`model` IS NOT NEW.`model` OR OLD.`reasoning` IS NOT NEW.`reasoning` OR OLD.`switches` IS NOT NEW.`switches` OR OLD.`system_prompt` IS NOT NEW.`system_prompt` THEN 1 ELSE 0 END) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1, `inherit_rev` = `inherit_rev` + excluded.`inherit_rev`; END;--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;