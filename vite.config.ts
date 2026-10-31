import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
