import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{js,jsx}'],
    env: { FORCE_COLOR: '0' },
  },
});
