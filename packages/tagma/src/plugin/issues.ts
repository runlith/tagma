import type { StandardSchemaV1 } from '@standard-schema/spec';

export const issueText = (issue: StandardSchemaV1.Issue): string => {
  const path = (issue.path ?? []).map((segment) => String(typeof segment === 'object' ? segment.key : segment));
  return path.length === 0 ? issue.message : `${path.join('.')}: ${issue.message}`;
};
