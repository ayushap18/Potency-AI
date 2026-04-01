import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Copies WASM binaries from the @runanywhere npm packages into dist/assets/
 * so they're served alongside the bundled JS at runtime.
 *
 * In dev mode, Vite serves node_modules directly so this only
 * matters for production builds.
 */
function copyWasmPlugin(): Plugin {
  const llamacppWasm = path.resolve(__dir, 'node_modules/@runanywhere/web-llamacpp/wasm');
  const onnxWasm = path.resolve(__dir, 'node_modules/@runanywhere/web-onnx/wasm');

  return {
    name: 'copy-wasm',
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dir, 'dist');
      const assetsDir = path.join(outDir, 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });

      // LlamaCpp WASM binaries (LLM/VLM)
      const llamacppFiles = [
        { src: 'racommons-llamacpp.wasm', dest: 'racommons-llamacpp.wasm' },
        { src: 'racommons-llamacpp.js', dest: 'racommons-llamacpp.js' },
        { src: 'racommons-llamacpp-webgpu.wasm', dest: 'racommons-llamacpp-webgpu.wasm' },
        { src: 'racommons-llamacpp-webgpu.js', dest: 'racommons-llamacpp-webgpu.js' },
      ];

      for (const { src, dest } of llamacppFiles) {
        const srcPath = path.join(llamacppWasm, src);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, path.join(assetsDir, dest));
          const sizeMB = (fs.statSync(srcPath).size / 1_000_000).toFixed(1);
          console.log(`  ✓ Copied ${dest} (${sizeMB} MB)`);
        } else {
          console.warn(`  ⚠ Not found: ${srcPath}`);
        }
      }

      // Sherpa-ONNX: copy all files in sherpa/ subdirectory (STT/TTS/VAD)
      const sherpaDir = path.join(onnxWasm, 'sherpa');
      const sherpaOut = path.join(assetsDir, 'sherpa');
      if (fs.existsSync(sherpaDir)) {
        fs.mkdirSync(sherpaOut, { recursive: true });
        for (const file of fs.readdirSync(sherpaDir)) {
          const src = path.join(sherpaDir, file);
          fs.copyFileSync(src, path.join(sherpaOut, file));
          const sizeMB = (fs.statSync(src).size / 1_000_000).toFixed(1);
          console.log(`  ✓ Copied sherpa/${file} (${sizeMB} MB)`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyWasmPlugin()],
  server: {
    headers: {
      // Cross-Origin Isolation — required for SharedArrayBuffer / multi-threaded WASM.
      // Without these headers the SDK falls back to single-threaded mode.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    // Suppress "Sourcemap points to missing source files" warnings from @runanywhere
    // packages — their .map files reference TypeScript sources not shipped in the bundle.
    sourcemapIgnoreList: (sourcePath) => sourcePath.includes('node_modules'),
  },
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es' },
  optimizeDeps: {
    // Exclude WASM-bearing packages from pre-bundling so their
    // import.meta.url resolves correctly to node_modules paths
    // (needed for automatic WASM file discovery at ../../wasm/).
    exclude: ['@runanywhere/web-llamacpp', '@runanywhere/web-onnx'],
  },
});
