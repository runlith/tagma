import type { ToolWords } from '@runlith/agent/tool/words';
import type { ToolName } from './index';

export const WORKSPACE_WORDS: Record<ToolName, ToolWords> = {
  read: {
    running: 'Reading',
    runningAlone: 'Reading a file',
    done: 'Read',
    doneAlone: 'Read a file',
    many: (count) => `Read ${count} files`,
  },
  write: { running: 'Writing', runningAlone: 'Writing a file', done: 'Wrote', doneAlone: 'Wrote a file' },
  edit: { running: 'Editing', runningAlone: 'Editing a file', done: 'Edited', doneAlone: 'Edited a file' },
  delete: { running: 'Deleting', runningAlone: 'Deleting a file', done: 'Deleted', doneAlone: 'Deleted a file' },
  rename: { running: 'Moving', runningAlone: 'Moving a file', done: 'Moved', doneAlone: 'Moved a file' },
  ls: {
    running: 'Listing',
    runningAlone: 'Listing a directory',
    done: 'Listed',
    doneAlone: 'Listed a directory',
    many: (count) => `Listed ${count} directories`,
  },
  glob: {
    running: 'Matching',
    runningAlone: 'Matching a pattern',
    done: 'Matched',
    doneAlone: 'Matched a pattern',
    many: (count) => `Matched ${count} patterns`,
  },
  grep: {
    running: 'Searching',
    runningAlone: 'Searching a pattern',
    done: 'Searched',
    doneAlone: 'Searched a pattern',
    many: (count) => `Searched ${count} patterns`,
  },
  bash: { running: 'Running', runningAlone: 'Running a command', done: 'Ran', doneAlone: 'Ran a command' },
  webfetch: {
    running: 'Fetching',
    runningAlone: 'Fetching a page',
    done: 'Fetched',
    doneAlone: 'Fetched a page',
    many: (count) => `Fetched ${count} pages`,
  },
  websearch: {
    running: 'Searching the web for',
    runningAlone: 'Searching the web',
    done: 'Searched the web for',
    doneAlone: 'Searched the web',
    many: (count) => `Searched the web ${count} times`,
  },
};
