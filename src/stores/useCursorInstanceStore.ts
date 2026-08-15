import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useCursorInstanceStore = createInstanceStore(
  createPlatformInstanceService('cursor'),
  'agtools.cursor.instances.cache',
);
