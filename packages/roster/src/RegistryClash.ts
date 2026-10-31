class RegistryClash extends Error {
  readonly holders: readonly string[];

  constructor(fields: { readonly message: string; readonly holders: readonly string[] }) {
    super(fields.message);
    this.name = 'RegistryClash';
    this.holders = fields.holders;
  }
}

export class RegistryRefusal extends Error {
  readonly contributor: string;

  constructor(fields: { readonly message: string; readonly contributor: string }) {
    super(fields.message);
    this.name = 'RegistryRefusal';
    this.contributor = fields.contributor;
  }
}

export function clashOf(subject: string, first: string, second: string): RegistryClash {
  return new RegistryClash({ message: `${subject} is contributed by both "${first}" and "${second}".`, holders: [first, second] });
}
