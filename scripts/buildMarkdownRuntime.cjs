const fs = require('node:fs');
const path = require('node:path');
const webpack = require('webpack');
const config = require('../webpack.markdown-runtime.config.cjs');

const projectRoot = path.resolve(__dirname, '..');
const katexDist = path.join(projectRoot, 'node_modules/katex/dist');
const vendorKatex = path.join(projectRoot, 'public/vendor/katex');

function copyKatexAssets() {
  fs.mkdirSync(vendorKatex, { recursive: true });
  fs.copyFileSync(
    path.join(katexDist, 'katex.min.css'),
    path.join(vendorKatex, 'katex.min.css')
  );
  fs.cpSync(
    path.join(katexDist, 'fonts'),
    path.join(vendorKatex, 'fonts'),
    { recursive: true, force: true }
  );
}

webpack(config, (error, stats) => {
  if (error) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  const output = stats.toString({ colors: false, chunks: false, modules: false });
  if (output) console.log(output);
  if (stats.hasErrors()) {
    process.exitCode = 1;
    return;
  }
  copyKatexAssets();
});
