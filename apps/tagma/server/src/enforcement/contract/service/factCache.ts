import { Context } from 'effect';

export class FactCache extends Context.Service<FactCache, { readonly root: string | undefined }>()('tagma/enforcement/FactCache') {}
