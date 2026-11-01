import { descriptionFault, modelCatalog } from '@runlith/llm/models/catalog';
import type { SubscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { Schema } from 'effect';
import type { Adapter, AdapterHost, AdapterSettings, HarnessAccountAuth, HarnessCommand, HarnessProvider, Provider } from './provider';
import { type SettingField, settingFieldSchema } from './settings';
import { harnessNameSchema, RESERVED_HARNESS_NAMES } from './harness';

export type Declaration = { readonly providers: readonly Provider[]; readonly settings: AdapterSettings | undefined };

export type SectionClaim = { readonly title: string; readonly default: string; readonly modes: ReadonlyMap<string, string> };

export const claimSections = (
  claims: ReadonlyMap<string, SectionClaim>,
  providers: readonly Provider[],
  holder: string,
): ReadonlyMap<string, SectionClaim> => {
  const next = new Map(claims);
  for (const { accountMode: mode } of providers) {
    if (mode === undefined) continue;
    const standing = next.get(mode.section);
    next.set(mode.section, {
      title: standing?.title ?? mode.title,
      default: standing?.default ?? mode.default,
      modes: new Map([...(standing?.modes ?? []), [mode.id, holder]]),
    });
  }
  return next;
};

const sectionFault = (claims: ReadonlyMap<string, SectionClaim>, provider: Provider): string | null => {
  const mode = provider.accountMode;
  const standing = mode === undefined ? undefined : claims.get(mode.section);
  if (mode === undefined || standing === undefined) return null;
  const holder = standing.modes.get(mode.id);
  if (holder !== undefined)
    return `provider "${provider.id}" declares mode "${mode.id}" of section "${mode.section}", already declared by ${holder}`;
  if (standing.title !== mode.title || standing.default !== mode.default)
    return `provider "${provider.id}" declares section "${mode.section}" with another title or default mode than its other modes`;
  return null;
};

const commandFault = (command: HarnessCommand | undefined): boolean =>
  typeof command?.program !== 'string' || !Array.isArray(command.args) || command.args.some((arg) => typeof arg !== 'string');

const accountsFault = (accounts: HarnessAccountAuth): boolean =>
  typeof accounts.directory !== 'string' ||
  accounts.directory === '' ||
  commandFault(accounts.login) ||
  commandFault(accounts.status) ||
  typeof accounts.loggedIn !== 'function' ||
  (accounts.renew !== undefined && commandFault(accounts.renew));

const subscriptionFault = (accounts: SubscriptionAccounts | undefined): boolean => {
  if (accounts === undefined || accounts.credential == null || typeof accounts.key !== 'function' || typeof accounts.label !== 'function')
    return true;
  if (!Array.isArray(accounts.signIns) || accounts.signIns.length === 0) return true;
  const kinds = new Set<string>();
  for (const method of accounts.signIns) {
    if (kinds.has(method.kind)) return true;
    kinds.add(method.kind);
    switch (method.kind) {
      case 'loopback':
        if (typeof method.run !== 'function') return true;
        break;
      case 'device':
        if (method.vendor == null || typeof method.store !== 'function') return true;
        break;
      case 'paste':
        if (typeof method.begin !== 'function') return true;
        break;
      case 'key':
        if (typeof method.store !== 'function') return true;
        break;
      default:
        return true;
    }
  }
  return false;
};

const harnessName = Schema.is(harnessNameSchema);

const surfaceFault = (provider: HarnessProvider): string | null => {
  const { terminal, acp } = provider;
  if (!harnessName(provider.id) || RESERVED_HARNESS_NAMES.includes(provider.id))
    return `harness provider "${provider.id}" needs an id of up to 64 lowercase letters, digits and hyphens that starts with a letter and is none of ${RESERVED_HARNESS_NAMES.join(', ')}`;
  if (
    terminal !== undefined &&
    (!hasText(terminal.binary) ||
      !hasText(terminal.prefix) ||
      typeof terminal.launch?.interactive !== 'function' ||
      typeof terminal.launch.resume !== 'function' ||
      typeof terminal.launch.root !== 'function')
  )
    return `harness provider "${provider.id}" declares a terminal surface without its binary, session prefix or launch`;
  if (acp !== undefined && (typeof acp.argv !== 'function' || typeof acp.configure !== 'function'))
    return `harness provider "${provider.id}" declares an ACP surface without its argv or configure`;
  if (terminal !== undefined && acp !== undefined && acp.hosts === null && acp.argv(undefined)[0] !== terminal.binary)
    return `harness provider "${provider.id}" launches its ACP agent with a program other than its terminal binary ${terminal.binary}`;
  if (terminal === undefined && acp !== undefined && acp.hosts !== null && !hasText(acp.program))
    return `harness provider "${provider.id}" hosts its ACP agent without a terminal surface and names no program its runner drives`;
  return null;
};

function shapeFault(provider: Provider): string | null {
  if (typeof provider.id !== 'string' || provider.id === '') return 'a provider declares no id';
  if (provider.catalog !== undefined && typeof provider.catalog.read !== 'function')
    return `provider "${provider.id}" declares a malformed catalog reader`;
  if (provider.dynamicCatalog === true && provider.catalog === undefined)
    return `provider "${provider.id}" declares a dynamic catalog without its reader`;
  const id = provider.id;
  const mode = provider.accountMode;
  if (
    mode !== undefined &&
    [mode.section, mode.title, mode.default, mode.id, mode.label, mode.hint].some((value) => typeof value !== 'string' || value === '')
  )
    return `provider "${provider.id}" declares a malformed account mode`;
  if (mode !== undefined && provider.accounts === undefined) return `provider "${provider.id}" declares an account mode without accounts`;
  if (provider.kind === 'wire') {
    if (typeof provider.profile?.model !== 'function') return `provider "${provider.id}" declares no request profile`;
    if (typeof provider.quota?.read !== 'function') return `provider "${provider.id}" declares no quota`;
    if (provider.auth === 'cli') return `wire provider "${provider.id}" signs in through a CLI`;
    if (provider.auth === 'oauth' && subscriptionFault(provider.accounts))
      return `provider "${provider.id}" declares no subscription accounts`;
    if (Object.keys(provider.imageModels ?? {}).length > 0 && typeof provider.images?.generate !== 'function')
      return `provider "${provider.id}" declares image models without an image profile`;
    return null;
  }
  if (provider.kind === 'harness') {
    if (provider.imageModels !== undefined) return `harness provider "${provider.id}" declares image models`;
    const surface = surfaceFault(provider);
    if (surface !== null) return surface;
    if (typeof provider.environment !== 'function') return `provider "${provider.id}" declares no account environment`;
    if (provider.auth === 'api-key')
      return subscriptionFault(provider.accounts) ? `provider "${provider.id}" declares malformed key accounts` : null;
    if (provider.accounts !== undefined && accountsFault(provider.accounts)) return `provider "${provider.id}" declares malformed accounts`;
    return provider.auth === 'cli' ? null : `harness provider "${id}" declares no supported sign-in`;
  }
  return `provider "${String((provider as { readonly id?: unknown }).id)}" is neither a wire nor a harness provider`;
}

const drawable = Schema.is(Schema.Array(settingFieldSchema));
const hasText = (value: unknown): boolean => typeof value === 'string' && value !== '';
const optionless = (field: SettingField): boolean =>
  ((field.type === 'choice' || field.type === 'set') && field.options.length === 0) ||
  (field.type === 'rows' && (field.fields.length === 0 || field.fields.some(optionless)));

const settingsFault = (settings: AdapterSettings | undefined): string | null => {
  if (settings === undefined) return null;
  if (!hasText(settings.title) || !hasText(settings.instance) || !hasText(settings.name))
    return 'the adapter declares settings without a title, an instance name or a naming field';
  if (!drawable(settings.fields)) return 'the adapter declares settings fields the Providers screen cannot draw';
  if (new Set(settings.fields.map((field) => field.id)).size !== settings.fields.length || settings.fields.some(optionless))
    return 'the adapter declares settings fields with repeated ids, or choices without options';
  if (settings.fields.some((field) => field.type === 'rows' && field.fields.some((leaf) => leaf.id === '_source' || leaf.id === '_key')))
    return 'row fields use reserved form metadata names';
  if (!settings.fields.some((field) => field.id === settings.name && field.type === 'text'))
    return 'the adapter declares settings without a text field that names an instance';
  if (
    (settings.validate !== undefined && typeof settings.validate !== 'function') ||
    (settings.discover !== undefined && typeof settings.discover !== 'function')
  )
    return 'the adapter declares settings whose validate or discover is not a function';
  return null;
};

export const declare = (
  entry: unknown,
  host: AdapterHost,
  taken: ReadonlyMap<string, string> = new Map(),
  sections: ReadonlyMap<string, SectionClaim> = new Map(),
): Declaration => {
  if (typeof entry !== 'object' || entry === null || !('adapter' in entry) || typeof entry.adapter !== 'function')
    throw new Error('the adapter entry exports no adapter');
  const adapter = entry.adapter as Adapter;
  const fault = settingsFault(adapter.settings);
  if (fault !== null) throw new Error(fault);
  const candidates = adapter(host);
  if (!Array.isArray(candidates)) throw new Error('the adapter entry does not answer a list of providers');
  const providers = candidates.map((provider): Provider =>
    provider.catalog === undefined ? provider : { ...provider, dynamicCatalog: true },
  );
  const seen = new Set<string>();
  let claims = sections;
  for (const provider of providers) {
    const fault = shapeFault(provider) ?? descriptionFault(provider) ?? sectionFault(claims, provider);
    if (fault !== null) throw new Error(fault);
    const holder = taken.get(provider.id) ?? (seen.has(provider.id) ? 'this adapter' : undefined);
    if (holder !== undefined) throw new Error(`provider "${provider.id}" is already declared by adapter ${holder}`);
    seen.add(provider.id);
    claims = claimSections(claims, [provider], 'this adapter');
  }
  modelCatalog(providers);
  return { providers, settings: adapter.settings };
};
