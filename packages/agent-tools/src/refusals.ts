import { ToolFailed } from '@runlith/agent/tool';

export const REFUSALS = {
  'not-found': 'Not found',
  'wrong-kind': 'Wrong kind of entry',
  'not-text': 'Not a text file',
  'too-large': 'Too large',
  'call-shape': 'Call not accepted',
  'no-match': 'No match',
  'bad-pattern': 'Invalid pattern',
  'many-matches': 'Several matches',
  'file-changed': 'File changed meanwhile',
  aliased: 'Path is an alias',
  'target-exists': 'Target already exists',
  'dangling-link': 'Broken link',
  'outside-workspace': 'Outside the workspace',
  'bad-cursor': 'Unknown page cursor',
  'cursor-stale': 'Page cursor out of date',
  'redirect-refused': 'Redirect not followed',
  'http-status': 'Server answered with an error',
  'sleeps-only': 'Command only waits',
  'file-edit': 'Use the file tools',
} as const;

export type Refusal = keyof typeof REFUSALS;

export const refused = (code: Refusal, reason: string): ToolFailed => new ToolFailed({ reason, code });
