UPDATE `native_thread` SET `capabilities` = json_set(`capabilities`, '$.steer', 'step')
WHERE json_extract(`transport`, '$.adapter') = 'terminal'
  AND json_extract(`transport`, '$.profile') IN ('claude-code', 'codex')
  AND json_extract(`capabilities`, '$.steer') = 'none';
