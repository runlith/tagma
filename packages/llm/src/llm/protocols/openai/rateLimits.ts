import type { RateLimitHeaders } from '../../route/executor';

const HEADER = /^x-ratelimit-(limit|remaining|reset)-(.+)$/;

export const rateLimits: RateLimitHeaders = (name) => {
  const match = HEADER.exec(name);
  const kind = match?.[1];
  const bucket = match?.[2];
  if (bucket === undefined || (kind !== 'limit' && kind !== 'remaining' && kind !== 'reset')) return undefined;
  return { bucket, kind };
};
