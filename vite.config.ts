import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Göreli taban: GitHub Pages'te repo adından bağımsız çalışır.
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
  },
});
