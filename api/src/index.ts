import { createApp } from './app.js'
import { env } from './env.js'

const app = createApp()

app.listen(env.apiPort, () => {
  console.log(`[api] listening on http://localhost:${env.apiPort}`)
})
