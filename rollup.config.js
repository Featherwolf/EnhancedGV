import deckyPlugin from "@decky/rollup";

// package.json declares "type": "module", so this .js file is ESM.
// @decky/rollup supplies all externals (react, react-dom, @decky/ui, @decky/api)
// and the output config; the bundle is emitted to dist/index.js.
export default deckyPlugin({
  // Extra Rollup options can be added here if ever needed.
});
