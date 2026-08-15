import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useInstanceStore = createInstanceStore(
  createPlatformInstanceService(''),
  'agtools.instances.cache',
);
