import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useCodebuddyInstanceStore = createInstanceStore(
  createPlatformInstanceService('codebuddy'),
  'agtools.codebuddy.instances.cache',
);
