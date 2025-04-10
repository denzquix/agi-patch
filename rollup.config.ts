
import { RollupOptions } from 'rollup';
import tsPlugin from '@rollup/plugin-typescript';
import nodeResolvePlugin from '@rollup/plugin-node-resolve';
import cjsPlugin from '@rollup/plugin-commonjs';
import copyPlugin from 'rollup-plugin-copy';

const options = new Array<RollupOptions>();

options.push({
  input: 'src/main.ts',
  output: {
    file: 'build/agi-patch.js',
    format: 'iife',
  },
  plugins: [
    tsPlugin({
      compilerOptions: {
        strict: true,
        target: "es6",
      },
    }),
    cjsPlugin({
    }),
    nodeResolvePlugin({
    }),
    copyPlugin({
      targets: [
        { src: 'static/*', dest:'build' },
      ],
      verbose: true,
    }),
  ],
});

export default options;
