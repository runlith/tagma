import type { RateLimitHeaders } from '../../route/executor';

const HEADER = /^anthropic-ratelimit-(.+)-(limit|remaining|reset)$/;

export const rateLimits: RateLimitHeaders = (name) => {
  const match = HEADER.exec(name);
  const bucket = match?.[1];
  const kind = match?.[2];
  if (bucket === undefined || (kind !== 'limit' && kind !== 'remaining' && kind !== 'reset')) return undefined;
  return { bucket, kind };
};
