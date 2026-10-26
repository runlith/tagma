import { DIRECTORY_OPERATIONS } from './directory.js';
import { PATH_OPERATIONS } from './paths.js';
import { PLACE_OPERATIONS } from './place.js';
import { REVEAL_OPERATIONS } from './reveal.js';
import { WRITE_OPERATIONS } from './writes.js';

export const FILE_OPERATIONS = {
  ...DIRECTORY_OPERATIONS,
  ...PATH_OPERATIONS,
  ...PLACE_OPERATIONS,
  ...REVEAL_OPERATIONS,
  ...WRITE_OPERATIONS,
};

export type FileOperationId = keyof typeof FILE_OPERATIONS;
