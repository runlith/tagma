import { Effect } from 'effect';
import { fetchTools } from '../src/lanes/iosTools';

const tools = await Effect.runPromise(fetchTools());
console.log(JSON.stringify(tools, null, 2));
