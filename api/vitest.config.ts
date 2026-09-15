import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    env: { DATABASE_URL: 'file:./test.db', USER_SHOPIFY_WEBHOOK_SECRET: 'test-secret' }
  }
})
