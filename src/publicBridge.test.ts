import { describe, expect, it, vi } from 'vitest'
import { PUBLIC_BRIDGE_MESSAGE, serializePublicBridge } from './publicBridge'
import type { PublicSnapshot } from './publicSnapshot'

const snapshot: PublicSnapshot = {
  app: 'tournamanager-live', version: 1, tournamentName: 'Volley Day', date: '2026-09-20', updatedAt: '2026-09-20T09:00:00.000Z',
  tournaments: [], playing: [], results: [], standings: [],
}

describe('ponte pubblico senza CORS', () => {
  it('trasporta lo snapshot completo tramite un messaggio isolato', () => {
    const postMessage = vi.fn()
    Function('globalThis', serializePublicBridge(snapshot))({ parent: { postMessage } })

    expect(postMessage).toHaveBeenCalledWith({ type: PUBLIC_BRIDGE_MESSAGE, snapshot }, '*')
  })
})
