import { defineConfig } from 'vitest/config';

// Unit tests: no database needed. Integration tests (*.int.test.ts) use vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts'],
  },
});
