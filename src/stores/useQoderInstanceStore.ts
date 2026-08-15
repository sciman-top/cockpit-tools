import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useQoderInstanceStore = createInstanceStore(
  createPlatformInstanceService('qoder'),
  'agtools.qoder.instances.cache',
);
