import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useKiroInstanceStore = createInstanceStore(
  createPlatformInstanceService('kiro'),
  'agtools.kiro.instances.cache',
);
