import { Context } from 'effect';

export class OwnSkillDirectories extends Context.Service<OwnSkillDirectories, (projectRoot: string) => readonly string[]>()(
  'tagma/native-harness/OwnSkillDirectories',
) {}
