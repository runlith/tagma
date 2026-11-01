import { Context } from 'effect';

export class DoorAddress extends Context.Service<DoorAddress, { readonly origin: () => string | null }>()('tagma/platform/DoorAddress') {}
