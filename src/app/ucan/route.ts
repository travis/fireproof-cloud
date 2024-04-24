import fromAsync from 'array-from-async';
import { AccessServiceContext, ProvisionsStorage } from "@web3-storage/upload-api";
import { createService as createAccessService } from "@web3-storage/upload-api/access";
import * as Server from "@ucanto/server";
import * as Signer from "@ucanto/principal/ed25519";
import { CAR } from "@ucanto/transport";


const createService = (context: AccessServiceContext) => ({
  access: createAccessService(context)
})

const idPromise = Signer.generate()

// @ts-expect-error I think this is unused by the access service
const provisionsStorage: ProvisionsStorage = null

const POSTMARK_TOKEN = process.env.POSTMARK_TOKEN

const createServer = async () => {
  const storedDelegations: Server.API.Delegation[] = []
  return Server.create({
    id: await idPromise,
    codec: CAR.inbound,
    service: createService({
      url: new URL('https://example.com'),
      signer: await idPromise,
      email: {
        sendValidation: async ({ to, url }) => {
          if (POSTMARK_TOKEN) {
            const rsp = await fetch('https://api.postmarkapp.com/email/withTemplate', {
              method: 'POST',
              headers: {
                Accept: 'text/json',
                'Content-Type': 'text/json',
                'X-Postmark-Server-Token': POSTMARK_TOKEN,
              },
              body: JSON.stringify({
                From: 'fireproof <noreply@fireproof.storage>',
                To: to,
                TemplateAlias: 'welcome',
                TemplateModel: {
                  product_url: 'https://fireproof.storage',
                  product_name: 'Fireproof Storage',
                  email: to,
                  action_url: url,
                },
              }),
            })

            if (!rsp.ok) {
              throw new Error(
                `Send email failed with status: ${rsp.status
                }, body: ${await rsp.text()}`
              )
            }
          } else {
            throw new Error("POSTMARK_TOKEN is not defined, can't send email")
          }
        }
      },
      provisionsStorage,
      rateLimitsStorage: {
        add: async () => ({ error: new Error('rate limits not supported') }),
        list: async () => ({ ok: [] }),
        remove: async () => ({ error: new Error('rate limits not supported') })
      },
      delegationsStorage: {
        putMany: async (delegations) => {
          storedDelegations.push(...delegations)
          return { ok: {} }
        },
        count: async () => BigInt(storedDelegations.length),
        find: async (audience) => {
          return { ok: storedDelegations.filter(delegation => delegation.audience.did() === audience.audience) }
        }
      }
    }),
    // validate all for now
    validateAuthorization: async () => ({ ok: {} })
  })
}

const serverPromise = createServer()

export async function POST (request: Request) {
  const server = await serverPromise
  request.headers
  if (request.body) {
    const payload = {
      body: await fromAsync(request.body),
      headers: Object.fromEntries(request.headers)
    }
    const result = server.codec.accept(payload)
    if (result.error) {
      throw new Error(`accept failed! ${result.error}`)
    }
    const { encoder, decoder } = result.ok
    const incoming = await decoder.decode(payload)
    // @ts-ignore not totally sure how to fix the "unknown" casting here or check if it's needed
    const outgoing = await Server.execute(incoming, server)
    const response = await encoder.encode(outgoing)
    return response
  } else {
    throw new Error('no body!')
  }

}