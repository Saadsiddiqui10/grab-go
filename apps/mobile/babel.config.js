/**
 * `babel-preset-expo` covers JSX, TypeScript, the Expo Router entry and the
 * React Compiler. Nothing else is needed: the app deliberately uses React
 * Native's own Animated API rather than a library that would require its own
 * Babel plugin.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
