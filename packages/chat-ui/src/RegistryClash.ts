import { Data } from 'effect';

export class RegistryClash extends Data.TaggedError('RegistryClash')<{
  readonly message: string;
  readonly holders: readonly string[];
}> {}

export function clashOf(subject: string, first: string, second: string): RegistryClash {
  return new RegistryClash({ message: `${subject} is contributed by both "${first}" and "${second}".`, holders: [first, second] });
}
