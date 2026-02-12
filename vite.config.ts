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
        target: 'es2015',

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
                // Manual chunks for better caching
                manualChunks: {
                    // Core React libraries
                    'vendor-react': ['react', 'react-dom'],

                    // Ant Design UI library (largest dependency)
                    'vendor-antd': ['antd', '@ant-design/icons'],

                    // Charts & visualization (if used)
                    'vendor-charts': ['recharts'],

                    // Date utilities
                    'vendor-utils': ['dayjs', 'dayjs/locale/vi'],

                    // Excel libraries
                    'vendor-excel': ['xlsx'],
                },

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
        // Pre-bundle these dependencies
        include: [
            'react',
            'react-dom',
            'antd',
            '@ant-design/icons',
            'dayjs',
            'xlsx',
        ],
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
