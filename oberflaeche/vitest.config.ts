// SPDX-License-Identifier: Apache-2.0
import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        testTimeout: 15000,
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
});
