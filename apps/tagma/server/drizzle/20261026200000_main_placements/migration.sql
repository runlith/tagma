WITH `former_main` AS (
  SELECT `repository`.`project_id` AS `project_id`, `file_root`.`root_id` AS `former_root`, `project_root`.`root_id` AS `main_root`
  FROM `file_root`
  JOIN `repository` ON `repository`.`repository_id` = `file_root`.`repository_id` AND `repository`.`common_directory` = `file_root`.`git_directory`
  JOIN `project_root` ON `project_root`.`project_id` = `repository`.`project_id` AND `project_root`.`origin` = 'canonical'
  WHERE `project_root`.`root_id` <> `file_root`.`root_id`
    AND NOT EXISTS (
      SELECT 1 FROM `project_root` AS `covering`
      WHERE `covering`.`project_id` = `repository`.`project_id` AND `covering`.`root_id` = `file_root`.`root_id`
    )
)
UPDATE `assignment_selection`
SET `root_id` = (
    SELECT `former_main`.`main_root` FROM `former_main`
    JOIN `thread` ON `thread`.`project_id` = `former_main`.`project_id`
    WHERE `thread`.`id` = `assignment_selection`.`thread_id` AND `former_main`.`former_root` = `assignment_selection`.`root_id`
  ),
  `revision` = `revision` + 1
WHERE EXISTS (
  SELECT 1 FROM `former_main`
  JOIN `thread` ON `thread`.`project_id` = `former_main`.`project_id`
  WHERE `thread`.`id` = `assignment_selection`.`thread_id` AND `former_main`.`former_root` = `assignment_selection`.`root_id`
);
--> statement-breakpoint
WITH `former_main` AS (
  SELECT `repository`.`project_id` AS `project_id`, `file_root`.`root_id` AS `former_root`, `project_root`.`root_id` AS `main_root`
  FROM `file_root`
  JOIN `repository` ON `repository`.`repository_id` = `file_root`.`repository_id` AND `repository`.`common_directory` = `file_root`.`git_directory`
  JOIN `project_root` ON `project_root`.`project_id` = `repository`.`project_id` AND `project_root`.`origin` = 'canonical'
  WHERE `project_root`.`root_id` <> `file_root`.`root_id`
    AND NOT EXISTS (
      SELECT 1 FROM `project_root` AS `covering`
      WHERE `covering`.`project_id` = `repository`.`project_id` AND `covering`.`root_id` = `file_root`.`root_id`
    )
)
INSERT OR IGNORE INTO `assignment_membership` (`thread_id`, `root_id`, `provenance`)
SELECT `assignment_membership`.`thread_id`, `former_main`.`main_root`, `assignment_membership`.`provenance`
FROM `assignment_membership`
JOIN `thread` ON `thread`.`id` = `assignment_membership`.`thread_id`
JOIN `former_main` ON `former_main`.`project_id` = `thread`.`project_id` AND `former_main`.`former_root` = `assignment_membership`.`root_id`;
--> statement-breakpoint
WITH `former_main` AS (
  SELECT `repository`.`project_id` AS `project_id`, `file_root`.`root_id` AS `former_root`, `project_root`.`root_id` AS `main_root`
  FROM `file_root`
  JOIN `repository` ON `repository`.`repository_id` = `file_root`.`repository_id` AND `repository`.`common_directory` = `file_root`.`git_directory`
  JOIN `project_root` ON `project_root`.`project_id` = `repository`.`project_id` AND `project_root`.`origin` = 'canonical'
  WHERE `project_root`.`root_id` <> `file_root`.`root_id`
    AND NOT EXISTS (
      SELECT 1 FROM `project_root` AS `covering`
      WHERE `covering`.`project_id` = `repository`.`project_id` AND `covering`.`root_id` = `file_root`.`root_id`
    )
)
DELETE FROM `assignment_membership`
WHERE EXISTS (
  SELECT 1 FROM `former_main`
  JOIN `thread` ON `thread`.`project_id` = `former_main`.`project_id`
  WHERE `thread`.`id` = `assignment_membership`.`thread_id` AND `former_main`.`former_root` = `assignment_membership`.`root_id`
);
