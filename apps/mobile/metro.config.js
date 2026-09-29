const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * Metro in an npm workspace.
 *
 * The app depends on @grabgo/* packages that live outside its own folder, so
 * Metro is told to watch the repository root and to resolve modules from both
 * the app's node_modules and the hoisted root one.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/*
 * Hierarchical lookup is deliberately left ON.
 *
 * Disabling it stops Metro walking into a dependency's own `node_modules`,
 * which breaks any package whose transitive dependencies npm chose to nest
 * rather than hoist — MapLibre's `@turf/*` packages, for one.
 *
 * The duplicate-React problem it is sometimes used to avoid does not arise
 * here: npm hoists a single `react` and `react-native` to the workspace root,
 * and `nodeModulesPaths` above already tells Metro where to look first.
 */

module.exports = config;
