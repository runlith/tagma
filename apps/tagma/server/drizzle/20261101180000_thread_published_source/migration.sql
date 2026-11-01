CREATE TABLE `thread_published_source` (
  `thread_id` text PRIMARY KEY NOT NULL REFERENCES `thread`(`id`) ON DELETE CASCADE,
  `generation` text NOT NULL,
  `bytes` integer NOT NULL,
  `position` integer NOT NULL,
  `form` text,
  `fingerprint` text NOT NULL,
  `fact_fingerprint` text NOT NULL,
  `origin` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_source_intent` (
  `thread_id` text PRIMARY KEY NOT NULL,
  `operation` text NOT NULL,
  `place` text NOT NULL,
  `stage` text NOT NULL,
  `digest` text NOT NULL,
  `previous` text,
  `previous_digest` text,
  `target` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `thread_source_change_rev_insert` AFTER INSERT ON `thread_published_source` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_source_change_rev_update` AFTER UPDATE ON `thread_published_source` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_source_change_rev_delete` AFTER DELETE ON `thread_published_source` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_base_change_rev_insert` AFTER INSERT ON `thread_base` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_base_change_rev_update` AFTER UPDATE ON `thread_base` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE OLD.`thread_id` <> NEW.`thread_id` AND EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_base_change_rev_delete` AFTER DELETE ON `thread_base` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_checkpoint_change_rev_insert` AFTER INSERT ON `thread_compaction_checkpoint` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_checkpoint_change_rev_update` AFTER UPDATE ON `thread_compaction_checkpoint` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE OLD.`thread_id` <> NEW.`thread_id` AND EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_checkpoint_change_rev_delete` AFTER DELETE ON `thread_compaction_checkpoint` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_pruned_change_rev_insert` AFTER INSERT ON `thread_pruned_tool_call` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_pruned_change_rev_update` AFTER UPDATE ON `thread_pruned_tool_call` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE OLD.`thread_id` <> NEW.`thread_id` AND EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_pruned_change_rev_delete` AFTER DELETE ON `thread_pruned_tool_call` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
