import { defineConfig } from 'vitest/config';

// GitHub Pages: https://abk7474.github.io/Engineering_Simulator/ — yayın derlemesi bu alt yolda çalışır.
// Önizleme (npm run preview) de alt yolda; geliştirme sunucusu (npm run dev, e2e betikleri) kökte kalır. Asset yolları import.meta.env.BASE_URL'den türer.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/Engineering_Simulator/' : '/',
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
