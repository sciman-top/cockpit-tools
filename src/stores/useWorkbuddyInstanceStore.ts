import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useWorkbuddyInstanceStore = createInstanceStore(
  createPlatformInstanceService('workbuddy'),
  'agtools.workbuddy.instances.cache',
);
