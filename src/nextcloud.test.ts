import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNextcloudPublication, normalizeNextcloudBaseUrl } from './nextcloud'
import type { PublicSnapshot } from './publicSnapshot'

const snapshot: PublicSnapshot = {
  app: 'tournamanager-live', version: 1, tournamentName: 'Volley Day', date: '2026-09-20', updatedAt: '2026-09-20T09:00:00.000Z',
  tournaments: [], playing: [], results: [], standings: [],
}

afterEach(() => vi.unstubAllGlobals())

describe('collegamento Nextcloud', () => {
  it('ricava la base anche da un link dell’app File', () => {
    expect(normalizeNextcloudBaseUrl('https://cloud.example.it/apps/files/files/123?dir=/Tornei')).toBe('https://cloud.example.it')
    expect(normalizeNextcloudBaseUrl('https://cloud.example.it/nextcloud/index.php/apps/files/files/123')).toBe('https://cloud.example.it/nextcloud')
    expect(normalizeNextcloudBaseUrl('https://cloud.example.it/nextcloud/remote.php/dav/files/mario')).toBe('https://cloud.example.it/nextcloud')
  })

  it('usa WebDAV CORS e l’API share di WebAppPassword', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 207 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ocs: { meta: { status: 'ok', statuscode: 100 }, data: { id: 42, token: 'pubblico', url: 'https://cloud.example.it/index.php/s/pubblico' } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const publication = await createNextcloudPublication({ baseUrl: 'https://cloud.example.it/apps/files', username: 'mario', password: 'app-password' }, 'volley-day.json', snapshot)

    expect(publication.remotePath).toBe('/TournaManager/volley-day.json')
    expect(publication.publicDataUrl).toBe('https://cloud.example.it/index.php/s/pubblico/download')
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(String(fetchMock.mock.calls[4][0])).toBe('https://cloud.example.it/index.php/apps/webapppassword/api/v1/shares?format=json')
    expect(String(fetchMock.mock.calls[4][1]?.body)).toContain('shareType=3')
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Requested-With')).toBe('XMLHttpRequest')
    expect(fetchMock.mock.calls[0][1]?.mode).toBe('cors')
  })
})
