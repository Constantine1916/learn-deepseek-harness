import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['examples/*/tests/**/*.snapshot.spec.ts'],
    testTimeout: 30_000,
  },
})
