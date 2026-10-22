const path = require('node:path');

module.exports = {
  mode: 'production',
  target: ['web', 'es2020'],
  entry: path.resolve(__dirname, 'build/markdownRuntime.entry.mjs'),
  devtool: false,
  resolve: {
    // Prefer the environment-neutral entity decoder so the same generated UMD
    // can be required by Node tests without a synthetic DOM.
    conditionNames: ['import', 'module', 'default'],
    mainFields: ['module', 'main'],
    aliasFields: []
  },
  output: {
    path: path.resolve(__dirname, 'public/vendor'),
    filename: 'markdownRuntime.js',
    library: {
      name: 'markdownRuntime',
      type: 'umd',
      export: 'default'
    },
    globalObject: 'globalThis',
    clean: false
  },
  optimization: {
    chunkIds: 'deterministic',
    moduleIds: 'deterministic',
    runtimeChunk: false,
    splitChunks: false
  },
  performance: {
    hints: false
  }
};
