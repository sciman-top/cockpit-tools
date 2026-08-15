import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useCodebuddyCnInstanceStore = createInstanceStore(
  createPlatformInstanceService('codebuddy_cn'),
  'agtools.codebuddycn.instances.cache',
);
