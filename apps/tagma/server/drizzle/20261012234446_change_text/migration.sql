CREATE TABLE `workspace_change_text` (
  `row` text PRIMARY KEY NOT NULL,
  `old_text` text,
  `new_text` text,
  CONSTRAINT `fk_workspace_change_text_row_workspace_change_id_fk` FOREIGN KEY (`row`) REFERENCES `workspace_change`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_change_retired_text` (
  `row` text PRIMARY KEY NOT NULL,
  CONSTRAINT `fk_workspace_change_retired_text_row_workspace_change_text_row_fk` FOREIGN KEY (`row`) REFERENCES `workspace_change_text`(`row`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `workspace_change_text` (`row`, `old_text`, `new_text`)
SELECT `id`, `old_text`, `new_text` FROM `workspace_change`
WHERE `old_text` IS NOT NULL OR `new_text` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `workspace_change_retired_text` (`row`)
SELECT t.`row` FROM `workspace_change_text` t JOIN `workspace_change` r ON r.`id` = t.`row`
WHERE r.`state` IN ('committed', 'withdrawn');
--> statement-breakpoint
DROP INDEX `workspace_change_retired_texts_idx`;
--> statement-breakpoint
ALTER TABLE `workspace_change` DROP COLUMN `old_text`;
--> statement-breakpoint
ALTER TABLE `workspace_change` DROP COLUMN `new_text`;
--> statement-breakpoint
CREATE TRIGGER `workspace_change_text_retired_state` AFTER UPDATE OF `state` ON `workspace_change`
WHEN NEW.`state` IN ('committed', 'withdrawn')
BEGIN
  INSERT OR IGNORE INTO `workspace_change_retired_text` (`row`)
  SELECT `row` FROM `workspace_change_text` WHERE `row` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `workspace_change_text_retired_insert` AFTER INSERT ON `workspace_change_text`
WHEN EXISTS (SELECT 1 FROM `workspace_change` WHERE `id` = NEW.`row` AND `state` IN ('committed', 'withdrawn'))
BEGIN
  INSERT OR IGNORE INTO `workspace_change_retired_text` (`row`) VALUES (NEW.`row`);
END;
