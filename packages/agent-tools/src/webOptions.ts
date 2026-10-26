import type { Egress } from './world';
import type { WebSearchOptions } from './workspace';

export type WebToolOptions = {
  readonly egress: Egress;
  readonly websearch?: WebSearchOptions;
};
