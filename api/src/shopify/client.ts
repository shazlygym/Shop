import { env } from '../env.js'

const API_VERSION = '2026-07'

interface ShopifyConfig {
  shopDomain?: string
  adminToken?: string
  fetchImpl?: typeof fetch
}

interface UserError {
  message: string
}

function orderGid(id: string): string {
  return id.startsWith('gid://') ? id : `gid://shopify/Order/${id}`
}

export function createShopifyClient(config: ShopifyConfig = {}) {
  const shopDomain = config.shopDomain ?? env.shopDomain
  const adminToken = config.adminToken ?? env.adminToken
  const doFetch = config.fetchImpl ?? fetch

  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await doFetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': adminToken
      },
      body: JSON.stringify({ query, variables })
    })

    if (!res.ok) {
      throw new Error(`Shopify HTTP ${res.status}`)
    }

    const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join('; '))
    }
    return json.data as T
  }

  return {
    async addTags(orderId: string, tags: string[]): Promise<void> {
      const data = await graphql<{ tagsAdd: { userErrors: UserError[] } }>(
        `mutation AddTags($id: ID!, $tags: [String!]!) {
           tagsAdd(id: $id, tags: $tags) { userErrors { message } }
         }`,
        { id: orderGid(orderId), tags }
      )
      if (data.tagsAdd.userErrors.length) {
        throw new Error(data.tagsAdd.userErrors.map((e) => e.message).join('; '))
      }
    },

    async appendNote(orderId: string, line: string): Promise<void> {
      const existing = await graphql<{ order: { note: string | null } | null }>(
        `query GetNote($id: ID!) { order(id: $id) { note } }`,
        { id: orderGid(orderId) }
      )
      const current = existing.order?.note ?? ''
      const note = current ? `${current}\n${line}` : line

      const data = await graphql<{ orderUpdate: { userErrors: UserError[] } }>(
        `mutation UpdateNote($input: OrderInput!) {
           orderUpdate(input: $input) { userErrors { message } }
         }`,
        { input: { id: orderGid(orderId), note } }
      )
      if (data.orderUpdate.userErrors.length) {
        throw new Error(data.orderUpdate.userErrors.map((e) => e.message).join('; '))
      }
    }
  }
}
