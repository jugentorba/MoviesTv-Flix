import { browserAddonSecretStore } from './BrowserAddonSecretStore';
import { createHostAwareAddonSecretStore } from './DesktopAddonSecretStore';

// The packaged desktop app persists provider links locally (see
// DesktopAddonSecretStore); the browser PWA keeps them in memory only.
export const runtimeAddonSecretStore = createHostAwareAddonSecretStore(browserAddonSecretStore);
