UPDATE `native_thread` SET `capabilities` = json_set(`capabilities`, '$.history', 'session', '$.copies', json('{"whole":"record","point":"record"}'))
WHERE json_extract(`transport`, '$.adapter') = 'terminal'
  AND json_extract(`capabilities`, '$.messaging') = 1
  AND json_extract(`capabilities`, '$.history') = 'none';
