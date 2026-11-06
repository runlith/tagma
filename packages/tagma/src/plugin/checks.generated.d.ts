import type { CompileOptions, ModuleCompileOptions } from 'svelte/compiler';

export declare const manifestRefusal: (manifest: unknown) => string | null;

export declare const pluginIdRefusal: (id: unknown) => string | null;

export declare const graphRefusal: (graph: unknown) => string | null;

export declare const VIEW_GRAPH: 'dist/ui';
export declare const GRAPH_FILE: 'graph.json';
export declare const UI_MODULE: string;
export declare const viewCompileOptions: (path: string, dependency: boolean) => CompileOptions;
export declare const viewModuleOptions: (path: string) => ModuleCompileOptions;
export declare const hostModules: (svelteExports: Readonly<Record<string, unknown>>) => readonly string[];
