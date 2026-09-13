import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNextcloudPublication, destroyNextcloudPublication, normalizeNextcloudBaseUrl, readNextcloudPublication, type NextcloudPublication } from './nextcloud'
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

  it('usa WebDAV CORS e condivide il file in lettura con l’account pubblico', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 207 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ocs: { meta: { status: 'ok', statuscode: 100 }, data: { id: 42, file_target: '/volley-day.json' } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const publication = await createNextcloudPublication({ baseUrl: 'https://cloud.example.it/apps/files', username: 'mario', password: 'app-password' }, 'lettore', 'volley-day.json', snapshot)

    expect(publication.remotePath).toBe('/TournaManager/volley-day.json')
    expect(publication.dataUrl).toBe('https://cloud.example.it/remote.php/dav/files/lettore/volley-day.json')
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(String(fetchMock.mock.calls[4][0])).toBe('https://cloud.example.it/index.php/apps/webapppassword/api/v1/shares?format=json')
    expect(String(fetchMock.mock.calls[4][1]?.body)).toContain('shareType=0')
    expect(String(fetchMock.mock.calls[4][1]?.body)).toContain('shareWith=lettore')
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Requested-With')).toBe('XMLHttpRequest')
    expect(fetchMock.mock.calls[0][1]?.mode).toBe('cors')
    expect(new Headers(fetchMock.mock.calls[3][1]?.headers).get('Content-Type')).toContain('application/json')
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual(snapshot)
  })

  it('legge il JSON con le credenziali dell’account pubblico', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const publication: NextcloudPublication = {
      baseUrl: 'https://cloud.example.it', username: 'mario', remotePath: '/TournaManager/torneo.json', shareId: '42',
      viewerUsername: 'lettore', viewerRemotePath: '/torneo.json', dataUrl: 'https://cloud.example.it/remote.php/dav/files/lettore/torneo.json',
    }

    await expect(readNextcloudPublication({ baseUrl: publication.baseUrl, username: 'lettore', password: 'password-pubblica' }, publication)).resolves.toEqual(snapshot)
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toMatch(/^Basic /)
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Requested-With')).toBe('XMLHttpRequest')
  })

  it('prova a eliminare il file anche se la rimozione della share fallisce', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('CORS'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const publication: NextcloudPublication = {
      baseUrl: 'https://cloud.example.it', username: 'mario', remotePath: '/TournaManager/torneo.json',
      shareId: '42', viewerUsername: 'lettore', viewerRemotePath: '/torneo.json', dataUrl: 'https://cloud.example.it/remote.php/dav/files/lettore/torneo.json',
    }

    const warnings = await destroyNextcloudPublication({ baseUrl: publication.baseUrl, username: 'mario', password: 'app-password' }, publication)

    expect(warnings).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/remote.php/dav/files/mario/TournaManager/torneo.json')
  })
})
