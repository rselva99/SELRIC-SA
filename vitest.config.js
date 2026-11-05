import { defineConfig } from 'vitest/config';

// Unit tests for the pure engines in src/lib. They run under node: the
// engines hold no DOM or React code. Suites that need the confidential golden
// fixture load it from outside the repository (see tests/helpers/private.js)
// and skip where it is not present.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    reporters: ['default'],
  },
});
