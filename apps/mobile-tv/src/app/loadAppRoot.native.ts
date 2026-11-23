import AppRoot from './AppRoot';

/**
 * Native loads `AppRoot` synchronously.
 *
 * In development, `import()` becomes a Metro split bundle, and the split bundle
 * carries its own HMR client instance. Its React Refresh setup then throws
 * `Expected HMRClient.setup() call at startup`, which the boot boundary reports
 * as a render error and the app never renders.
 *
 * This costs nothing in a release build, where Metro inlines the dynamic import
 * anyway. The web variant keeps the lazy load because a browser benefits from
 * the smaller first bundle.
 */
export default AppRoot;
