import { Effect } from 'effect';
import { fetchTools } from '../src/lanes/iosTools';
import { prepareTemplate } from '../src/lanes/simulator';

const tools = await Effect.runPromise(fetchTools());
console.log(JSON.stringify(tools, null, 2));
for (const runtime of (process.env.E2E_IOS_RUNTIMES ?? '26').split(',')) {
  const template = await Effect.runPromise(prepareTemplate({ runtime, deviceType: process.env.E2E_IOS_DEVICE_TYPE }));
  console.log(JSON.stringify(template, null, 2));
}
