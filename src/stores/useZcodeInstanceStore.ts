import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useZcodeInstanceStore = createInstanceStore(
  createPlatformInstanceService('zcode'),
  'agtools.zcode.instances.cache',
);
