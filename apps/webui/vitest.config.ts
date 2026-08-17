import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // npm-workspaces 下曾有 react 18/19 双副本（根 18 为历史遗留，icons/plots 等 peer
    // 实际都兼容 19），已通过 npm install react@19 收敛为单实例；dedupe 兜底防止回退
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    alias: {
      '@': join(__dirname, 'src'),
      '@root': join(__dirname),
      '@@': join(__dirname, 'src', '.umi'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setupTests.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Exclude Umi integration tests that depend on @umijs/max test infrastructure
    // These require Umi's Jest runner and cannot be used with Vitest directly
    exclude: [
      'src/pages/user/login/login.test.tsx',
      'node_modules',
      'dist',
      '.umi',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/.umi/**',
        'src/services/ant-design-pro/**',
        'src/**/*.d.ts',
        'src/**/index.style.ts',
      ],
    },
    passWithNoTests: true,
    testTimeout: 15000,
  },
});
