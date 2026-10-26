import type { LinkPort } from '$lib/shared/ExternalLinks.js';
import { INVALID_PARAMS, type ViewMethod, type ViewParams, ViewRefusal } from './ViewBridge.js';

export const needed = (params: ViewParams, name: string): string => {
  const value = params[name];
  if (typeof value !== 'string' || value.length === 0) throw new ViewRefusal(INVALID_PARAMS, `${name} is required`);
  return value;
};

export const argumentsOf = (params: ViewParams): Record<string, unknown> => {
  const args = params.arguments;
  if (args === undefined) return {};
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new ViewRefusal(INVALID_PARAMS, 'arguments is an object');
  return args as Record<string, unknown>;
};

export const openLink =
  (links: LinkPort): ViewMethod =>
  async (params) => {
    const url = URL.parse(needed(params, 'url'));
    if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      throw new ViewRefusal(INVALID_PARAMS, 'only an http or https link opens');
    }
    if (!navigator.userActivation.isActive) throw new Error('a link opens only from a click in the view');
    links.open(url.href);
    return {};
  };
