import { defineConfig } from 'vitest/config';
import { materialsPlugin } from './scripts/materials-plugin.ts';

// GitHub Pages: https://abk7474.github.io/Engineering_Simulator/ — yayın derlemesi bu alt yolda çalışır.
// Önizleme (npm run preview) de alt yolda; geliştirme sunucusu (npm run dev, e2e betikleri) kökte kalır. Asset yolları import.meta.env.BASE_URL'den türer.
// ders_materyalleri/ izleme eklentisi yalnız geliştirme sunucusunda (apply: 'serve'); onaylı içeriği content/library ve
// content/analysis altına yazar. Bu klasörler izlemeden çıkarılır: yazılınca açık oyun yeniden yüklenmesin.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/Engineering_Simulator/' : '/',
  plugins: [materialsPlugin()],
  server: {
    watch: { ignored: ['**/content/library/**', '**/content/analysis/**'] },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
}));
