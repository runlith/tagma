ALTER TABLE `execution` RENAME COLUMN `tty` TO `terminal`;
--> statement-breakpoint
WITH steps(source, destination) AS (
  VALUES ('SIGHUP', 'hang-up'), ('SIGINT', 'interrupt'), ('SIGTERM', 'terminate'), ('SIGKILL', 'kill')
), relations(source, destination) AS (
  VALUES ('process-group', 'work'), ('same-tty', 'terminal')
), entries AS (
  SELECT stored.rowid AS entity, entry.key AS position,
    CASE WHEN step.destination IS NULL THEN entry.value ELSE json_set(entry.value, '$.step', step.destination) END AS body,
    relation.destination AS relation,
    step.destination IS NOT NULL OR relation.destination IS NOT NULL AS changed
  FROM final_facts AS stored, json_each(stored.confirmed) AS entry
  LEFT JOIN steps AS step ON step.source = json_extract(entry.value, '$.step')
  LEFT JOIN relations AS relation ON relation.source = json_extract(entry.value, '$.relation')
), mapped AS (
  SELECT entity,
    json_group_array(json(CASE WHEN relation IS NULL THEN body ELSE json_set(body, '$.relation', relation) END) ORDER BY position) AS body
  FROM entries GROUP BY entity HAVING sum(changed) > 0
)
UPDATE final_facts AS stored SET confirmed = mapped.body FROM mapped WHERE mapped.entity = stored.rowid;
--> statement-breakpoint
WITH relations(source, destination) AS (
  VALUES ('process-group', 'work'), ('same-tty', 'terminal')
), mapped AS (
  SELECT stored.rowid AS entity,
    json_group_array(json(CASE WHEN relation.destination IS NULL THEN entry.value ELSE json_set(entry.value, '$.relation', relation.destination) END) ORDER BY entry.key) AS body
  FROM final_facts AS stored, json_each(stored.residual) AS entry
  LEFT JOIN relations AS relation ON relation.source = json_extract(entry.value, '$.relation')
  GROUP BY stored.rowid HAVING count(relation.destination) > 0
)
UPDATE final_facts AS stored SET residual = mapped.body FROM mapped WHERE mapped.entity = stored.rowid;
--> statement-breakpoint
UPDATE final_facts
SET coverage = replace(replace(coverage, '"process-group"', '"work"'), '"same-tty"', '"terminal"')
WHERE instr(coverage, '"process-group"') > 0 OR instr(coverage, '"same-tty"') > 0;
--> statement-breakpoint
UPDATE stop_intent
SET coverage = replace(replace(coverage, '"process-group"', '"work"'), '"same-tty"', '"terminal"')
WHERE instr(coverage, '"process-group"') > 0 OR instr(coverage, '"same-tty"') > 0;
