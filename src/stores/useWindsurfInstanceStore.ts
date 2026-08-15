import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useWindsurfInstanceStore = createInstanceStore(
  createPlatformInstanceService('windsurf'),
  'agtools.windsurf.instances.cache',
);
