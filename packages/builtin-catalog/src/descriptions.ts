import { icon as anthropicIcon } from '@runlith/adapter-anthropic/icon';
import { anthropicVendor } from '@runlith/adapter-anthropic/models/anthropic';
import { deepseekVendor } from '@runlith/adapter-deepseek/models/deepseek';
import { type ProviderDescription, pickerOrder } from '@runlith/llm/models/description';
import { icon as devinIcon } from '@runlith/adapter-devin/icon';
import { devinVendor } from '@runlith/adapter-devin/models/devin';
import { icon as museIcon } from '@runlith/adapter-muse/icon';
import { museVendor } from '@runlith/adapter-muse/models/muse';
import { icon as openaiIcon } from '@runlith/adapter-openai/icon';
import { openaiVendor } from '@runlith/adapter-openai/models/openai';
import { icon as opencodeGoIcon } from '@runlith/adapter-opencode-go/icon';
import { opencodeGoVendor } from '@runlith/adapter-opencode-go/models/opencodeGo';
import { icon as stepfunIcon } from '@runlith/adapter-stepfun/icon';
import { stepfunVendor } from '@runlith/adapter-stepfun/models/stepfun';
import { icon as xaiIcon } from '@runlith/adapter-xai/icon';
import { xaiVendor } from '@runlith/adapter-xai/models/xai';
import { subscriptionDescription } from './subscription/description';

type Group = { readonly providers: readonly ProviderDescription[]; readonly icon: string | null };

const GROUPS: readonly Group[] = [
  { providers: [subscriptionDescription, ...anthropicVendor.providers], icon: anthropicIcon },
  { providers: openaiVendor.providers, icon: openaiIcon },
  { providers: deepseekVendor.providers, icon: null },
  { providers: xaiVendor.providers, icon: xaiIcon },
  { providers: museVendor.providers, icon: museIcon },
  { providers: devinVendor.providers, icon: devinIcon },
  { providers: opencodeGoVendor.providers, icon: opencodeGoIcon },
  { providers: stepfunVendor.providers, icon: stepfunIcon },
];

export const DEFAULT_PROVIDER_DESCRIPTIONS: readonly ProviderDescription[] = pickerOrder(GROUPS.map((group) => group.providers));

export const DEFAULT_PROVIDER_ICONS: ReadonlyMap<string, string> = new Map(
  GROUPS.flatMap(({ providers, icon }) => (icon === null ? [] : providers.map((provider) => [provider.id, icon] as const))),
);
