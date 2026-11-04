import { Effect } from 'effect';
import type { LoadedLibrary } from '../../posix/Library';
import { selected } from '../selection';

export const processReader = (library: LoadedLibrary) => Effect.flatMap(selected, (system) => system.nativePlatform.processes(library));
export const platformFacts = (library: LoadedLibrary) => Effect.flatMap(selected, (system) => system.nativePlatform.facts(library));
export const platformIdentity = (library: LoadedLibrary) => Effect.map(selected, (system) => system.nativePlatform.identity(library));
export const openUsage = (path: string) => Effect.flatMap(selected, (system) => system.nativePlatform.usage(path));
