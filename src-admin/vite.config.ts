import react from '@vitejs/plugin-react';
import commonjs from 'vite-plugin-commonjs';
import { federation } from '@module-federation/vite';

// NOTE: deliberately NOT using @iobroker/gui-components's moduleFederationShared() helper here.
// It blindly shares every known package found in package.json, including @iobroker/gui-components
// itself (only needed here for the vite build tooling, never imported by our component code).
// Marking it as a federation "shared" singleton made the Vite/Rolldown build hang indefinitely
// while bundling its fallback ("prebuild") chunk - reproduced on both Vite 7 and Vite 8, with and
// without dts generation. Only declaring the packages we actually import avoids that entirely.
const config = {
    plugins: [
        federation({
            manifest: true,
            dts: false,
            name: 'DbtimetablesAdminSet',
            filename: 'customComponents.js',
            exposes: {
                './Components': './src/Components.tsx',
            },
            remotes: {},
            shared: {
                react: { requiredVersion: '*', singleton: true },
                'react-dom': { requiredVersion: '*', singleton: true },
                '@mui/material': { requiredVersion: '*', singleton: true },
                '@mui/icons-material': { requiredVersion: '*', singleton: true },
                '@iobroker/json-config': { requiredVersion: '*', singleton: true },
            },
        }),
        react(),
        commonjs(),
    ],
    resolve: {
        tsconfigPaths: true,
    },
    server: {
        port: 3000,
    },
    base: './',
    build: {
        target: 'chrome89',
        outDir: './build',
        chunkSizeWarningLimit: 3000,
    },
};

export default config;
