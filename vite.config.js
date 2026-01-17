import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: '/joinery/',
  
  // Exclude duckdb-wasm from pre-bundling (needs special WASM asset handling)
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  
  server: {
    port: 5173,
    strictPort: true,
  },
  
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'esnext',
    // Don't inline WASM files
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 25000,
    rollupOptions: {
      output: {
        manualChunks: {
          duckdb: ['@duckdb/duckdb-wasm'],
        },
      },
    },
  },
  
  clearScreen: false,
});
