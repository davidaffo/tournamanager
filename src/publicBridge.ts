import type { PublicSnapshot } from './publicSnapshot'

export const PUBLIC_BRIDGE_MESSAGE = 'tournamanager-live-snapshot'

export function serializePublicBridge(snapshot: PublicSnapshot): string {
  const json = JSON.stringify(snapshot).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `globalThis.parent.postMessage({type:${JSON.stringify(PUBLIC_BRIDGE_MESSAGE)},snapshot:${json}}, '*');\n`
}

const htmlAttribute = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

export function loadPublicBridge(source: string, timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.setAttribute('sandbox', 'allow-scripts')
    const url = new URL(source)
    url.searchParams.set('_', Date.now().toString())
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https:"><script src="${htmlAttribute(url.toString())}"></script>`

    const cleanup = () => {
      window.clearTimeout(timeout)
      window.removeEventListener('message', receive)
      frame.remove()
    }
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.type !== PUBLIC_BRIDGE_MESSAGE) return
      cleanup()
      resolve(event.data.snapshot)
    }
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Nextcloud non ha restituito i dati entro il tempo previsto'))
    }, timeoutMs)

    window.addEventListener('message', receive)
    document.body.append(frame)
  })
}
