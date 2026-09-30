import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/vector_test?host=/tmp',
      OWNER_EMAIL: 'test@vector.local',
      OWNER_PASSWORD: 'test-password',
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
