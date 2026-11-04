import { Abi } from '../ProcessAbi';
import { serveProcesses } from '../ProcessServer';
import { Sampler } from '../Sampler';
import { nativeUsage, sampling } from './sampling';

serveProcesses((path) => {
  const processes = Abi.load(path);
  return { processes, sampler: new Sampler(nativeUsage(path), processes, sampling) };
});
