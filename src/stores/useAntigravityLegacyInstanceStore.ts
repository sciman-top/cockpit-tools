import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useAntigravityLegacyInstanceStore = createInstanceStore(
  createPlatformInstanceService('antigravity_legacy'),
  'agtools.antigravity_legacy.instances.cache',
);
