ALTER TABLE `native_thread_rev` ADD `change_open` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TRIGGER `native_thread_change_rev_insert` AFTER INSERT ON `native_thread` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `native_thread_change_rev_update` AFTER UPDATE ON `native_thread` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_change_rev_insert` AFTER INSERT ON `thread` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_change_rev_update` AFTER UPDATE ON `thread` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_change_rev_delete` AFTER DELETE ON `thread` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_mandate_change_rev_insert` AFTER INSERT ON `thread_mandate` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_mandate_change_rev_update` AFTER UPDATE ON `thread_mandate` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_mandate_change_rev_delete` AFTER DELETE ON `thread_mandate` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_run_change_rev_insert` AFTER INSERT ON `thread_run` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_run_change_rev_update` AFTER UPDATE ON `thread_run` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_run_change_rev_delete` AFTER DELETE ON `thread_run` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_event_change_rev_insert` AFTER INSERT ON `thread_event` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_event_change_rev_update` AFTER UPDATE ON `thread_event` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_event_change_rev_delete` AFTER DELETE ON `thread_event` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_entry_change_rev_insert` AFTER INSERT ON `thread_entry` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_entry_change_rev_update` AFTER UPDATE ON `thread_entry` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_entry_change_rev_delete` AFTER DELETE ON `thread_entry` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_inbox_change_rev_insert` AFTER INSERT ON `thread_inbox` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_inbox_change_rev_update` AFTER UPDATE ON `thread_inbox` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_inbox_change_rev_delete` AFTER DELETE ON `thread_inbox` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_call_change_rev_insert` AFTER INSERT ON `thread_call` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_call_change_rev_update` AFTER UPDATE ON `thread_call` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_call_change_rev_delete` AFTER DELETE ON `thread_call` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `external_session_change_rev_insert` AFTER INSERT ON `external_session` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `external_session_change_rev_update` AFTER UPDATE ON `external_session` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `external_session_change_rev_delete` AFTER DELETE ON `external_session` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_view_pin_change_rev_insert` AFTER INSERT ON `thread_view_pin` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_view_pin_change_rev_update` AFTER UPDATE ON `thread_view_pin` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_view_pin_change_rev_delete` AFTER DELETE ON `thread_view_pin` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
