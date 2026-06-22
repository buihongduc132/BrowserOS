import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

export default [
  {
    input: 'src/background.ts',
    output: { file: 'dist/background.iife.js', format: 'iife' },
    plugins: [resolve({ browser: true }), commonjs(), typescript()],
  },
  {
    input: 'src/content-script.ts',
    output: { file: 'dist/content-script.iife.js', format: 'iife' },
    plugins: [resolve({ browser: true }), commonjs(), typescript()],
  },
  {
    input: 'src/popup.ts',
    output: { file: 'dist/popup.iife.js', format: 'iife', name: 'BrowserOSAdblockerPopup' },
    plugins: [resolve({ browser: true }), commonjs(), typescript()],
  },
];
