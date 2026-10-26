import { js } from '@runlith/code-facts/adapters';
import { configResolver } from '@runlith/code-facts/js/config';
import { resolveUnique } from '@runlith/code-facts/js/resolve';
import { queryOf, sitesOf, type Tree } from '@runlith/code-facts/tree';
import { matchesGlob, posix } from 'node:path';
import { EnvelopeExceeded } from '../../../core/node/budget';
import {
  checkedOnce,
  listedUnit,
  parentOf,
  type Hit,
  type InspectionMemo,
  type Keyed,
  type MemoStats,
  type MemoValue,
  validMemo,
  wholeUnit,
} from '../../../core/node/memo';
import { localOf, picks, resolvedGlobs } from '../../../core/node/select';
import { keep, type Need, type Scope, type Sliced } from '../../../core/node/slices';
import type { Violation } from '../../../core/verdict';
import { narrowing, refusalOf } from '../loads/declaration';
import { ClosureExceeded, collectInto, digestOf, type File, memoDependencies, reachOf, type Wording } from './closure';
import { builtinOn, type Platform, platforms, runningOf } from './declaration';
import { entryOf, manifestOf, outputsOf, packageOf, resolveDoor } from './doors';
import { type Contribution, ledgerOf, remember, unitObjects, variantOf } from './records';
import {
  appStarts,
  declaredStart,
  doorRoot,
  markerViolation,
  nameViolations,
  packageStarted,
  packageStarts,
  routedOf,
  type AppReading,
  type Root,
} from './starts';
import { covered, globbed, inside, messageOf, type Of, pathOf, type Snapshot, snapshotOf, under, workspaceFailure } from './snapshot';
import {
  AMBIGUOUS_FIX,
  doorless,
  doorMissingFix,
  landing,
  NO_PACKAGE_FIX,
  NON_LITERAL_FIX,
  originRefused,
  OUTSIDE_FIX,
  platformRefused,
  RELATIVE_GLOB_FIX,
  routesFix,
  undeclared,
  UNREADABLE_FIX,
  unprovided,
} from './wording';

type Summary = { readonly key: string; readonly value: MemoValue };

const MIB = 1024 * 1024;
const PACKAGE_NAME = /^(?:@[A-Za-z0-9~-][\w.~-]*\/)?[A-Za-z0-9~-][\w.~-]*$/u;
const empty = (): File => ({ edges: [], causes: [], dependencies: new Map(), listings: new Map(), violations: [], universal: [] });

export function readSlice(
  params: Of,
  source: Tree,
  scope: Scope,
  supplied?: InspectionMemo,
  trusted?: InspectionMemo,
  prepared?: Snapshot,
  places: readonly string[] = [''],
): Sliced {
  const held: InspectionMemo = supplied ?? new Map();
  const stats = supplied?.stats;
  const memo: InspectionMemo = {
    get: (key) => trusted?.get(key) ?? held.get(key),
    set: (key, value) => {
      held.set(key, value);
    },
  };
  const examined = new Set<string>();
  const count = (path: string): void => {
    const object = source.object?.(path) ?? path;
    if (examined.has(object)) return;
    examined.add(object);
    if (stats !== undefined) stats.blobs += 1;
  };
  const tree: Tree = {
    ...source,
    read: (path) => {
      count(path);
      return source.read(path);
    },
    sites: (path) => {
      count(path);
      return sitesOf(source, path, [js]);
    },
  };
  let snapshot: Snapshot;
  try {
    snapshot = prepared ?? snapshotOf(params, tree);
  } catch (error) {
    if (error instanceof EnvelopeExceeded) throw error;
    return { violations: [workspaceFailure(params.base, error)], universal: [], needs: [] };
  }
  const { paths, inventory, packagePaths } = snapshot;
  const { packages, ownerOf } = inventory;
  const checked = supplied?.checked ?? checkedOnce();
  const objects = unitObjects(tree, snapshot.units);
  const maximum = Math.floor((platforms.envelope.mib * MIB) / 384);
  let units = 0;
  const spend = (count: number): void => {
    if ((units += count) > maximum)
      throw new ClosureExceeded(
        maximum,
        scope.parts === 'whole' ? undefined : scope.parts.map((part) => part.package ?? 'files outside packages'),
      );
  };
  const parts = scope.parts === 'whole' ? undefined : new Map(scope.parts.map((part) => [part.package, part.judged]));
  const owns = (name: string | undefined): boolean => parts === undefined || parts.has(name ?? null);
  const judges = (name: string | undefined): boolean => parts === undefined || parts.get(name ?? null) === true;
  const owned = (file: string): boolean => owns(ownerOf(file)?.name);
  const generated = (file: string): boolean =>
    params.apps.some((app) => {
      const at = pathOf(params.base, app.at);
      return inside(file, at) && (app.generated ?? []).some((pattern) => matchesGlob(file.slice(at.length + 1), pattern));
    });
  const injected = (file: string): boolean =>
    params.apps.some((app) => {
      const at = pathOf(params.base, app.at);
      return inside(file, at) && (app.injected ?? []).some((pattern) => matchesGlob(file.slice(at.length + 1), pattern));
    });
  const loader = (file: string): boolean => (params.loaders ?? []).some(({ at }) => file === pathOf(params.base, at));
  const running = runningOf(params);
  const named = Object.keys(params.platforms);
  const configured = configResolver(
    tree,
    (name) => packages.get(name)?.dir,
    new Map((params.built ?? []).map(({ output, source }) => [pathOf(params.base, output), pathOf(params.base, source)])),
  );
  const listingStamps = new Map<string, string>();
  const listing = (query: string): string => {
    const held = listingStamps.get(query);
    if (held !== undefined) return held;
    const [kind, value] = JSON.parse(query) as [string, string | readonly string[]];
    const answer =
      kind === 'package' ? (packages.get(value as string)?.dir ?? '') : digestOf(globbed(snapshot, value as readonly string[], spend));
    listingStamps.set(query, answer);
    return answer;
  };
  const paramsKey = digestOf([params, places]);
  const ledger = ledgerOf(paramsKey, objects, snapshot.units.members, memo, listing, checked, inventory);
  const judged = scope.parts === 'whole' ? [...packages.keys(), null] : scope.parts.flatMap((part) => (part.judged ? [part.package] : []));
  const reused = new Map<string | null, Contribution>();
  for (const part of judged) {
    const held = ledger.reuse(part);
    if (held !== undefined) reused.set(part, held);
  }
  const fresh = (name: string | undefined): boolean => judges(name) && !reused.has(name ?? null);
  const owning = new Map<string | null, { readonly violations: Violation[]; readonly keys: string[] }>();
  const ownOf = (name: string | undefined) => {
    let held = owning.get(name ?? null);
    if (held === undefined) owning.set(name ?? null, (held = { violations: [], keys: [] }));
    return held;
  };
  const roots = new Map<Platform, Map<string, Root>>(named.map((platform) => [platform, new Map()]));
  const add = (root: Root): void => {
    if (!roots.get(root.platform)!.has(root.id)) roots.get(root.platform)!.set(root.id, root);
  };
  for (const root of packageStarts(params, snapshot, source, fresh)) add(root);
  const unenumerated: { readonly at: string; readonly startsOf: (file: string) => readonly Root[] }[] = [];
  const appReading: AppReading = { params, tree, snapshot, judges, generated };
  const freshDirs =
    params.apps.length === 0 ? [] : judged.flatMap((name) => (name !== null && fresh(name) ? [packages.get(name)!.dir] : []));
  for (const app of params.apps) {
    const at = pathOf(params.base, app.at);
    const holder = ownerOf(posix.join(at, 'package.json'))?.name;
    if (!judges(holder)) continue;
    const { startsOf } = appStarts(app, appReading);
    if (fresh(holder) || freshDirs.some((dir) => inside(dir, at))) {
      for (const file of under(paths, at)) for (const root of startsOf(file)) add(root);
    } else unenumerated.push({ at, startsOf });
    const routed = routedOf(params, app);
    if (
      fresh(holder) &&
      routed !== undefined &&
      !Iterator.from(under(paths, routed)).some((file) => app.routes!.pages.includes(posix.basename(file)))
    )
      ownOf(holder).violations.push({
        fingerprint: `${app.at} -> unresolved ${app.routes!.at} @ ${posix.join(at, 'package.json')}`,
        file: posix.join(at, 'package.json'),
        line: 1,
        specifier: app.routes!.at,
        message: 'The declared routes directory holds no page the rule names',
        fix: routesFix(app.at, app.routes!.at, app.routes!.pages),
      });
  }
  const needs = new Map<string, Need>();
  for (const [name, policy] of Object.entries(params.packages)) {
    if ((policy.names?.length ?? 0) === 0 || !fresh(name)) continue;
    const member = packages.get(name);
    if (member === undefined) continue;
    const refused = refusalOf(policy.names ?? [], []);
    const manifest = manifestOf(member);
    for (const file of packagePaths.get(name) ?? []) {
      const local = localOf(params.base, file);
      if (local === undefined || generated(file) || !picks(params.files, local)) continue;
      const index = `platforms/names/${digestOf(policy.names)}/${file}`;
      const valid = variantOf(memo, index, (one) => validMemo(one, objects, listing, memo, checked));
      if (valid !== undefined) {
        ownOf(name).keys.push(valid);
        continue;
      }
      const violations = nameViolations(tree, file, name, refused);
      const value: MemoValue = {
        dependencies: [
          [file, source.object?.(file) ?? null],
          [manifest, source.object?.(manifest) ?? null],
          [inventory.manifest, source.object?.(inventory.manifest) ?? null],
        ],
        listings: [],
        violations,
        read: [],
      };
      const key = `platforms/name/${digestOf(value)}`;
      remember(memo, index, key, value);
      ownOf(name).keys.push(key);
    }
  }
  const keyOf = (root: Root) => `platforms/start/${paramsKey}/${root.platform}/${root.id}`;
  for (const platform of named) {
    const starts = roots.get(platform)!;
    const indexKey = (file: string) => `platforms/frontier/${paramsKey}/${platform}/${file}`;
    const known = (file: string): Summary | undefined => {
      const key = indexKey(file);
      const content =
        trusted?.get(key)?.parents?.[0] ??
        variantOf(memo, key, (one) => memo.get(one)?.hits !== undefined && validMemo(one, objects, listing, memo, checked));
      const value = content === undefined ? undefined : memo.get(content);
      if (content === undefined || value?.hits === undefined) return undefined;
      trusted?.set(key, { dependencies: [], listings: [], parents: [content], violations: [], read: [] });
      trusted?.set(content, value);
      return { key: content, value };
    };
    const reachKey = (file: string) => `platforms/reach/${paramsKey}/${platform}/${file}`;
    const reachedBefore = (file: string): Summary | undefined => {
      const content = variantOf(
        memo,
        reachKey(file),
        (one) => memo.get(one)?.hits !== undefined && validMemo(one, objects, listing, memo, checked),
      );
      const value = content === undefined ? undefined : memo.get(content);
      return value?.hits === undefined || value.parents?.[0] === undefined ? undefined : { key: value.parents[0], value };
    };
    const globalRefusal = refusalOf(params.refuses[platform] ?? [], params.allows[platform] ?? []);
    const allowed = refusalOf(params.allows[platform] ?? [], []);
    const originRefusals = Object.entries(params.packages).map(([name, rule]) => ({
      name,
      refuses: refusalOf([...(rule.loads?.any ?? []), ...(rule.loads?.[platform] ?? [])], []),
    }));
    const packageStands = packageStarted(params, snapshot, source, platform, new Set(starts.keys()), reused.keys());
    const startedOn = (id: string, file: string): boolean =>
      packageStands(id, file) ||
      unenumerated.some((app) => inside(file, app.at) && app.startsOf(file).some((one) => one.platform === platform && one.id === id));
    const startStandsOn = (file: string): (readonly [string, string | null])[] => {
      const app = params.apps.find((candidate) => inside(file, pathOf(params.base, candidate.at)));
      const routed = app === undefined ? undefined : routedOf(params, app);
      return routed === undefined || !inside(file, routed) ? [] : [[wholeUnit(routed), objects?.(wholeUnit(routed)) ?? null]];
    };
    const pending: Root[] = [];
    for (const root of starts.values()) {
      if (!fresh(root.package)) continue;
      if (stats !== undefined) stats.starts += 1;
      const valid = variantOf(memo, keyOf(root), (one) => validMemo(one, objects, listing, memo, checked));
      if (valid !== undefined) {
        ownOf(root.package).keys.push(valid);
        continue;
      }
      if (stats !== undefined) stats.walked += 1;
      pending.push(root);
    }
    const entryFiles = scope.entries
      .filter((entry) => entry.platform === platform && owned(entry.file) && known(entry.file) === undefined)
      .map(({ file }) => file);
    const nodes = new Map<string, File>();
    const frontier = new Map<string, Summary | undefined>();
    const frontierOf = (file: string): void => {
      if (!frontier.has(file)) frontier.set(file, known(file));
    };
    const discovered = new Map<string, Set<string>>();
    const found = new Map<string, Root>();
    const queue: string[] = [];
    const reach = (file: string): void => {
      if (owned(file)) queue.push(file);
      else frontierOf(file);
    };
    const rootViolations = new Map<string, readonly Violation[]>();
    for (const root of pending) {
      const declared = declaredStart(params, tree, root);
      if (declared.walks) reach(root.file);
      rootViolations.set(root.id, declared.violations);
    }
    queue.push(...entryFiles);
    for (let at = 0; at < queue.length; at += 1) {
      const file = queue[at]!;
      if (nodes.has(file) || frontier.has(file)) continue;
      const before = reachedBefore(file);
      if (before !== undefined) {
        frontier.set(file, before);
        continue;
      }
      const app = params.apps.find((candidate) => inside(file, pathOf(params.base, candidate.at)));
      const internal = app === undefined ? (params.internal ?? []) : [...(params.internal ?? []), ...app.internal];
      const node: File = empty();
      nodes.set(file, node);
      const dependency = (path: string): void => {
        const object = source.object?.(path);
        if (object !== undefined) {
          node.dependencies.set(path, object);
          return;
        }
        const unit = listedUnit(parentOf(path));
        node.dependencies.set(unit, objects?.(unit) ?? null);
      };
      const queried = (query: string): void => {
        node.listings.set(query, listing(query));
      };
      const measured: Tree = {
        ...tree,
        has: (path) => {
          dependency(path);
          return tree.has(path);
        },
      };
      dependency(file);
      dependency(inventory.manifest);
      const routed = app === undefined ? undefined : routedOf(params, app);
      const option = app?.routes?.option;
      if (platform === params.rendering?.server && routed !== undefined && option !== undefined && inside(file, routed)) {
        for (let dir = posix.dirname(file); inside(dir, routed); dir = posix.dirname(dir)) {
          for (const name of option.layouts) dependency(posix.join(dir, name));
          if (dir === routed) break;
        }
        for (const name of option.pages) dependency(posix.join(posix.dirname(file), name));
      }
      const owner = ownerOf(file);
      if (owner !== undefined) dependency(manifestOf(owner.member));
      const cause = (
        site: { line: number; specifier: string; absent?: readonly string[] },
        suffix: string,
        { message, fix }: Wording,
        origin?: string,
      ): void => {
        node.causes.push({
          ...site,
          file,
          group: `${origin ?? ''}\0${suffix}`,
          suffix,
          origin,
          message,
          fix,
        });
      };
      const unresolved = (
        { line, specifier }: { line: number; specifier: string },
        reason: string,
        fix: string,
        absent: readonly string[] = [],
      ): void =>
        cause({ line, specifier, absent: absent.length === 0 ? undefined : absent }, `unresolved ${specifier} @ ${file}`, {
          message: reason,
          fix: landing(absent, fix),
        });
      const enter = (to: string, site: { line: number; specifier: string }, handoff: boolean): void => {
        node.edges.push({ ...site, file, to, handoff });
        reach(to);
      };
      const discover = (root: Root): void => {
        const place = root.package === undefined ? root.file : packages.get(root.package)?.dir;
        if (!judges(root.package) && (owns(root.package) || place === undefined || !covered(places, place))) return;
        const id = `${root.id}\0${root.package ?? ''}`;
        for (const [name, object] of startStandsOn(root.file)) node.dependencies.set(name, object);
        if (
          !found.has(id) &&
          !(owned(root.file) ? startedOn(root.id, root.file) : root.id === root.file && known(root.file)?.value.started === true)
        )
          found.set(id, root);
        const by = discovered.get(id);
        if (by === undefined) discovered.set(id, new Set([file]));
        else by.add(file);
      };
      const queryLeaves = params.leaves.filter((leaf) => leaf.startsWith('?'));
      try {
        for (const site of sitesOf(tree, file, [js])) {
          const specifier = site.specifier;
          if (site.loads === 'never') continue;
          if (site.kind === 'unresolved') {
            if (!injected(file) && !loader(file)) unresolved(site, 'A non-literal load cannot be resolved', NON_LITERAL_FIX);
            continue;
          }
          if (site.kind === 'glob') {
            const patterns = resolvedGlobs(file, site.patterns ?? []);
            if (patterns === undefined) {
              unresolved(site, 'The glob pattern is not relative to its source', RELATIVE_GLOB_FIX);
              continue;
            }
            queried(JSON.stringify(['glob', patterns]));
            for (const target of globbed(snapshot, patterns, spend)) {
              if (!generated(target) && !params.leaves.some((suffix) => target.endsWith(suffix))) enter(target, site, false);
            }
            continue;
          }
          const started = site.kind === 'worker' ? undefined : queryOf(params.workers ?? [], specifier);
          const worker = site.kind === 'worker' || started !== undefined;
          if (!worker && queryOf(specifier.includes('?') ? queryLeaves : params.leaves, specifier) !== undefined) continue;
          const request =
            site.kind === 'worker' ? specifier.split('?')[0]! : started !== undefined ? specifier.slice(0, -started.length) : specifier;
          const inputs = new Set<string>();
          const alias = request.startsWith('.') || request.startsWith('/') ? null : configured(request, file, measured, inputs);
          for (const input of inputs) dependency(input);
          if (alias !== null && generated('to' in alias ? alias.to : alias.unlisted)) continue;
          if (alias !== null && 'to' in alias) {
            if (worker) discover({ id: alias.to, file: alias.to, platform, internal, package: owner?.name });
            if (!params.leaves.some((suffix) => alias.to.endsWith(suffix))) enter(alias.to, site, worker);
            continue;
          }
          if (
            internal.some(
              (prefix) => request === prefix || request.startsWith(`${prefix}/`) || (prefix.endsWith(':') && request.startsWith(prefix)),
            )
          )
            continue;
          const builtin = builtinOn(running.declared, platform, request);
          const listed = globalRefusal(request);
          if (listed !== undefined)
            cause(site, listed, platformRefused(platform, request, narrowing(params.allows[platform] ?? [], listed)));
          else if (builtin?.refused === true && allowed(request) === undefined)
            cause(site, builtin.name, unprovided(platform, request, builtin.name));
          for (const origin of originRefusals) {
            const entry = origin.refuses(request);
            if (entry !== undefined) cause(site, entry, originRefused(platform, request, origin.name), origin.name);
          }
          if (builtin !== undefined) continue;
          if (request.startsWith('.')) {
            const target = posix.join(posix.dirname(file), request);
            if (generated(target)) continue;
            const resolved = resolveUnique(request, file, measured);
            if ('unresolved' in resolved) {
              if (
                resolved.unresolved === 'no file resolves the specifier' &&
                owner !== undefined &&
                params.compiled.includes(owner.name) &&
                outputsOf(owner.member, measured.has).some((output) => inside(target, output))
              )
                continue;
              unresolved(
                site,
                resolved.unresolved,
                resolved.unresolved === 'no file resolves the specifier' ? 'Point the import at a file the tree holds.' : AMBIGUOUS_FIX,
                resolved.absent,
              );
              continue;
            }
            if (worker) discover({ id: resolved.to, file: resolved.to, platform, internal, package: owner?.name });
            if (params.leaves.some((suffix) => resolved.to.endsWith(suffix))) continue;
            enter(resolved.to, site, worker);
            continue;
          }
          if (request.startsWith('#') || request.startsWith('/') || request.includes(':') || request.includes('?')) {
            unresolved(site, 'The specifier is outside supported resolution', OUTSIDE_FIX);
            continue;
          }
          const name = packageOf(request);
          if (!PACKAGE_NAME.test(name)) {
            unresolved(
              site,
              'The specifier names no package, alias or internal prefix',
              NO_PACKAGE_FIX,
              alias === null ? [] : [alias.unlisted],
            );
            continue;
          }
          queried(JSON.stringify(['package', name]));
          const member = packages.get(name);
          if (member === undefined) continue;
          dependency(manifestOf(member));
          if (
            owner !== undefined &&
            owner.name !== name &&
            !['dependencies', 'peerDependencies', 'optionalDependencies'].some((field) => {
              const declared = owner.member.manifest[field];
              return declared !== null && typeof declared === 'object' && Object.hasOwn(declared, name);
            })
          )
            node.violations.push({
              fingerprint: `${file} -> ${name} (undeclared)`,
              file,
              line: site.line,
              specifier,
              chain: [specifier],
              ...undeclared(name, manifestOf(owner.member)),
            });
          const door = resolveDoor(name, member, entryOf(name, request), platform, running, site.form);
          if (door.problem !== undefined) cause(site, `${door.id} (no ${platform})`, doorless(platform, request, door));
          if (door.marker !== undefined) node.violations.push(markerViolation(door, door.marker));
          if (door.file === undefined || !measured.has(door.file)) {
            if (!params.compiled.includes(name))
              unresolved(site, 'The workspace door resolves to no file', doorMissingFix(door), door.file === undefined ? [] : [door.file]);
            continue;
          }
          if (door.problem === undefined) discover(doorRoot(door));
          enter(door.file, site, door.problem === undefined);
        }
      } catch (error) {
        if (error instanceof EnvelopeExceeded || error instanceof ClosureExceeded) throw error;
        unresolved({ line: 1, specifier: file }, messageOf(error), UNREADABLE_FIX);
      }
    }
    for (const root of found.values()) if (!owned(root.file)) frontierOf(root.file);
    for (const [file, value] of frontier) {
      if (value === undefined) needs.set(`${platform}\0${file}`, { platform, file, package: ownerOf(file)?.name ?? null });
    }
    if (needs.size > 0) continue;
    const reached = reachOf(nodes, new Map([...frontier].map(([file, summary]) => [file, summary!.value.hits!])), spend);
    const hitsOf = (file: string): readonly Hit[] => (nodes.has(file) ? reached.hits(file) : (frontier.get(file)?.value.hits ?? []));
    const outcome = (root: Root): { readonly violations: Violation[]; readonly universal: Keyed[] } => {
      const violations: Violation[] = [],
        keyed: Keyed[] = [];
      for (const hit of hitsOf(root.file)) {
        if (hit.origin !== undefined && hit.origin !== root.package) continue;
        const violation: Violation = {
          fingerprint: `${root.label ?? root.id} [${platform}] -> ${hit.suffix}`,
          file: hit.file,
          line: hit.line,
          specifier: hit.specifier,
          chain: [...hit.chain, hit.specifier],
          message: hit.message,
          fix: hit.fix,
          absent: hit.absent,
        };
        if (hit.origin === undefined) keyed.push({ key: `${root.package ?? root.id}\0${platform}\0${hit.suffix}`, violation });
        else violations.push(violation);
      }
      return { violations, universal: keyed };
    };
    for (const [id, root] of found) {
      const held = outcome(root);
      for (const file of discovered.get(id) ?? []) {
        const node = nodes.get(file)!;
        node.violations.push(...held.violations);
        node.universal.push(...held.universal);
      }
    }
    const components = memoDependencies(nodes, memo, (file) => frontier.get(file)!.key);
    const parentsOf = (file: string): string[] => {
      if (nodes.has(file)) return [components.get(file)!];
      const summary = frontier.get(file);
      return summary === undefined ? [] : [summary.key];
    };
    for (const root of pending) {
      const { violations, universal: keyed } = outcome(root);
      const dependencies: [string, string | null][] = [[inventory.manifest, source.object?.(inventory.manifest) ?? null]];
      if (root.door !== undefined) dependencies.push([root.door.manifest, source.object?.(root.door.manifest) ?? null]);
      if (root.manifestEntry !== undefined)
        dependencies.push([root.manifestEntry.manifest, source.object?.(root.manifestEntry.manifest) ?? null]);
      dependencies.push([root.file, source.object?.(root.file) ?? null]);
      const value: MemoValue = {
        dependencies,
        listings: [],
        parents: parentsOf(root.file),
        violations: [...rootViolations.get(root.id)!, ...violations],
        universal: keyed,
        read: [],
      };
      const key = `platforms/start/${digestOf(value)}`;
      remember(memo, keyOf(root), key, value);
      ownOf(root.package).keys.push(key);
    }
    for (const file of nodes.keys()) {
      const value: MemoValue = {
        dependencies: [[file, source.object?.(file) ?? null]],
        listings: [],
        parents: parentsOf(file),
        violations: [],
        hits: reached.hits(file),
        read: [],
      };
      remember(memo, reachKey(file), `platforms/hits/${digestOf(value)}`, value);
    }
    const summarized = new Set([
      ...entryFiles,
      ...pending.flatMap((root) => (root.door?.file === root.file && (nodes.has(root.file) || owned(root.file)) ? [root.file] : [])),
    ]);
    const collected = new Map<string, { readonly violations: readonly Violation[]; readonly universal: readonly Keyed[] }>();
    for (const file of summarized) {
      const key = indexKey(file);
      const component = parentsOf(file)[0];
      if (component === undefined || trusted?.get(key) !== undefined) continue;
      let summary = collected.get(component);
      if (summary === undefined) {
        const violations: Violation[] = [],
          keyed: Keyed[] = [];
        collectInto(memo.get, [component], new Set(), violations, keyed);
        const firsts = new Map<string, Violation>();
        for (const one of keyed) keep(firsts, one);
        summary = {
          violations: [...new Map(violations.map((one) => [one.fingerprint, one])).values()],
          universal: [...firsts].map(([universalKey, violation]) => ({ key: universalKey, violation })),
        };
        collected.set(component, summary);
      }
      const object = source.object?.(file) ?? null;
      const value: MemoValue = {
        dependencies: [[file, object], ...startStandsOn(file)],
        listings: [],
        parents: [component],
        violations: summary.violations,
        universal: summary.universal,
        hits: hitsOf(file),
        started: startedOn(file, file) ? true : undefined,
        read: [],
      };
      const content = `platforms/entry/${digestOf(value)}`;
      remember(memo, key, content, value);
      trusted?.set(content, value);
      trusted?.set(key, { dependencies: [], listings: [], parents: [content], violations: [], read: [] });
    }
  }
  if (needs.size > 0) return { violations: [], universal: [], needs: [...needs.values()] };
  const answers: Violation[] = [];
  const firsts = new Map<string, Violation>();
  for (const part of judged) {
    const own = owning.get(part) ?? { violations: [], keys: [] };
    const held = reused.get(part) ?? contributionOf(memo, own.violations, own.keys);
    if (!reused.has(part)) ledger.write(part, part === null ? undefined : packages.get(part)?.dir, held, own.keys);
    answers.push(...held.violations);
    for (const one of held.universal) keep(firsts, one);
  }
  return {
    violations: [...new Map(answers.map((one) => [one.fingerprint, one])).values()],
    universal: [...firsts].map(([key, violation]) => ({ key, violation })),
    needs: [],
  };
}

const contributionOf = (memo: InspectionMemo, own: readonly Violation[], keys: readonly string[]): Contribution => {
  const violations = [...own],
    universal: Keyed[] = [];
  collectInto(memo.get, keys, new Set(), violations, universal);
  const firsts = new Map<string, Violation>();
  for (const one of universal) keep(firsts, one);
  return {
    violations: [...new Map(violations.map((one) => [one.fingerprint, one])).values()],
    universal: [...firsts].map(([key, violation]) => ({ key, violation })),
  };
};

export function measuredSlice(
  params: Of,
  tree: Tree,
  scope: Scope,
  memo: InspectionMemo,
  trusted?: InspectionMemo,
  snapshot?: Snapshot,
  places: readonly string[] = [''],
): Sliced {
  const stats: MemoStats = { starts: 0, walked: 0, blobs: 0 };
  const measured: InspectionMemo = {
    get: memo.get,
    set: memo.set,
    stats,
    checked: memo.checked,
  };
  return { ...readSlice(params, tree, scope, measured, trusted, snapshot, places), stats };
}
