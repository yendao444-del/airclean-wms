import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    base: './',
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
    },

    // ⚡ BUILD OPTIMIZATION
    build: {
        // Target modern browsers for smaller output
        target: 'esnext',

        // Output directory
        outDir: 'dist',

        // Generate sourcemaps only in development
        sourcemap: false,

        // Minification với esbuild (faster, built-in)
        minify: 'esbuild',

        // Chunk size warning limit (500 KB)
        chunkSizeWarningLimit: 500,

        // 🎯 CODE SPLITTING & VENDOR CHUNKS
        rollupOptions: {
            output: {
                // Explicit package-only chunks keep shared React runtime out
                // of lazy feature bundles. The object form also pulled chart
                // dependencies into vendor-charts, making it preload at login.
                manualChunks(id) {
                    const normalizedId = id.replace(/\\/g, '/');
                    if (normalizedId.includes('/node_modules/recharts/')) return 'vendor-charts';
                    if (normalizedId.includes('/node_modules/dayjs/')) return 'vendor-utils';
                    if (normalizedId.includes('/node_modules/xlsx/')) return 'vendor-excel';
                    return undefined;
                },

                // Keep React and other shared runtime dependencies in the
                // entry/shared graph instead of pulling them into a lazy
                // feature chunk such as recharts.
                onlyExplicitManualChunks: true,

                // Naming pattern for chunks
                chunkFileNames: 'assets/js/[name]-[hash].js',
                entryFileNames: 'assets/js/[name]-[hash].js',
                assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
            },
        },

        // CSS code splitting
        cssCodeSplit: true,

        // Asset inlining threshold (4kb)
        assetsInlineLimit: 4096,

        // Report compressed size (may slow build)
        reportCompressedSize: true,
    },

    // ⚡ OPTIMIZATION FOR DEPENDENCIES
    optimizeDeps: {
        // Keep the initial set small: feature-only packages are discovered when
        // their lazy page is opened instead of blocking the first app window.
        include: [
            'react',
            'react-dom',
            'antd',
            'dayjs',
        ],
        // The explicit shell dependencies above are known up front, so let the
        // browser consume their result without waiting for the full import crawl.
        holdUntilCrawlEnd: false,
        // Exclude from pre-bundling (already optimized)
        exclude: [],
    },

    // ⚡ PERFORMANCE HINTS
    esbuild: {
        // Faster builds
        logOverride: { 'this-is-undefined-in-esm': 'silent' },
        // Smaller output
        legalComments: 'none',
        // Remove console.log and debugger in production
        drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    },
});
