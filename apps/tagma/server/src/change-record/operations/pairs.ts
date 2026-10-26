import { readAuthorship } from './authorship.js';
import { readChanges } from './changes.js';
import { readThreadHistory } from './history.js';
import { recordReported } from './record.js';
import { stripComments } from './sweep.js';
import { revertLines } from './revert.js';

export const CHANGE_PAIRS = {
  read_authorship: readAuthorship,
  read_changes: readChanges,
  read_thread_history: readThreadHistory,
  strip_comments: stripComments,
  record_write: recordReported,
  revert_lines: revertLines,
};
