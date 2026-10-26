CREATE INDEX `workspace_change_ended_order_idx` ON `workspace_change` (`checkout`,`path`,`at`,`id`) WHERE "workspace_change"."state" in ('committed', 'withdrawn');
--> statement-breakpoint
DROP TRIGGER `workspace_change_text_retired_state`;
--> statement-breakpoint
CREATE TRIGGER `workspace_change_text_retired_state` AFTER UPDATE OF `state` ON `workspace_change`
WHEN NEW.`state` IN ('committed', 'withdrawn')
BEGIN
  INSERT OR IGNORE INTO `workspace_change_retired_text` (`row`)
  SELECT t.`row` FROM `workspace_change` w JOIN `workspace_change_text` t ON t.`row` = w.`id`
  WHERE w.`checkout` = NEW.`checkout` AND w.`path` = NEW.`path` AND w.`state` IN ('committed', 'withdrawn')
    AND (w.`at` > NEW.`at` OR (w.`at` = NEW.`at` AND w.`id` >= NEW.`id`))
    AND NOT EXISTS (
      SELECT 1 FROM `workspace_change` e
      WHERE e.`checkout` = w.`checkout` AND e.`path` = w.`path` AND e.`state` IN ('writing', 'held')
        AND (e.`at` < w.`at` OR (e.`at` = w.`at` AND e.`id` < w.`id`))
    );
END;
--> statement-breakpoint
DROP TRIGGER `workspace_change_text_retired_insert`;
--> statement-breakpoint
CREATE TRIGGER `workspace_change_text_retired_insert` AFTER INSERT ON `workspace_change_text`
WHEN EXISTS (
  SELECT 1 FROM `workspace_change` w
  WHERE w.`id` = NEW.`row` AND w.`state` IN ('committed', 'withdrawn')
    AND NOT EXISTS (
      SELECT 1 FROM `workspace_change` e
      WHERE e.`checkout` = w.`checkout` AND e.`path` = w.`path` AND e.`state` IN ('writing', 'held')
        AND (e.`at` < w.`at` OR (e.`at` = w.`at` AND e.`id` < w.`id`))
    )
)
BEGIN
  INSERT OR IGNORE INTO `workspace_change_retired_text` (`row`) VALUES (NEW.`row`);
END;
