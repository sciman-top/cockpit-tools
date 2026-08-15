import { createPlatformInstanceService } from '../services/platform/createPlatformInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useGitHubCopilotInstanceStore = createInstanceStore(
  createPlatformInstanceService('github_copilot'),
  'agtools.github_copilot.instances.cache',
);
