DROP TRIGGER `external_session_change_rev_update`;
--> statement-breakpoint
CREATE TRIGGER `external_session_change_rev_update` AFTER UPDATE OF `facet`, `lease_owner` ON `external_session` WHEN OLD.`facet` IS NOT NEW.`facet` OR OLD.`lease_owner` IS NOT NEW.`lease_owner` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `change_rev`) SELECT NEW.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `change_rev` = `change_rev` + 1; END;
