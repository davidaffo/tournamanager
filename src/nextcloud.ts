import type { PublicSnapshot } from './publicSnapshot'

export type NextcloudCredentials = { baseUrl: string; username: string; password: string }
export type NextcloudPublication = {
  baseUrl: string
  username: string
  remotePath: string
  shareId: string
  shareUrl: string
  publicDataUrl: string
}

type OcsMeta = { status?: string; statuscode?: number | string; message?: string }
type OcsEnvelope<T> = { ocs?: { meta?: OcsMeta; data?: T } }
type RawShare = { id?: number | string; token?: string; url?: string }

const shareTokenFromUrl = (shareUrl: string): string => {
  try {
    const match = new URL(shareUrl).pathname.match(/\/(?:index\.php\/)?s\/([^/]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  } catch { return '' }
}

export function publicNextcloudDataUrl(baseUrl: string, shareUrl: string, token?: string): string {
  const shareToken = token?.trim() || shareTokenFromUrl(shareUrl)
  if (!shareToken) throw new Error('Nextcloud non ha restituito un token pubblico valido.')
  return `${normalizeNextcloudBaseUrl(baseUrl)}/public.php/dav/files/${encodeURIComponent(shareToken)}`
}

export function normalizePublicNextcloudSource(source: string): string {
  try {
    const url = new URL(source)
    const match = url.pathname.match(/^(.*?)\/(?:index\.php\/)?s\/([^/]+)\/download\/?$/)
    if (!match) return source
    return `${url.origin}${match[1]}/public.php/dav/files/${encodeURIComponent(decodeURIComponent(match[2]))}`
  } catch { return source }
}

export function normalizeNextcloudBaseUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) }
  catch { throw new Error('Il link Nextcloud non è valido.') }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('L’indirizzo Nextcloud deve usare HTTPS.')
  if (/\/(?:index\.php\/)?s\/[^/]+\/?$/.test(url.pathname)) throw new Error('Inserisci il link del tuo Nextcloud, non una condivisione pubblica.')

  const filesMarker = url.pathname.indexOf('/apps/files')
  const davMarker = url.pathname.indexOf('/remote.php/dav')
  const internalFile = url.pathname.match(/^(.*?)(?:\/index\.php)?\/f\/\d+\/?$/)
  const rawPath = filesMarker >= 0
    ? url.pathname.slice(0, filesMarker)
    : davMarker >= 0
      ? url.pathname.slice(0, davMarker)
      : internalFile
        ? internalFile[1]
        : url.pathname === '/' || url.pathname === '/index.php' ? '' : url.pathname
  return `${url.origin}${rawPath.replace(/\/index\.php$/, '').replace(/\/+$/, '')}`
}

const encodedPath = (value: string) => value.split('/').filter(Boolean).map(encodeURIComponent).join('/')
const basicAuthorization = (username: string, password: string) => {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return `Basic ${btoa(binary)}`
}
const filesRootUrl = (credentials: NextcloudCredentials) => `${credentials.baseUrl}/remote.php/dav/files/${encodeURIComponent(credentials.username)}`
const davUrl = (credentials: NextcloudCredentials, remotePath: string) => `${filesRootUrl(credentials)}/${encodedPath(remotePath)}`
const davHeaders = (credentials: NextcloudCredentials, extra?: HeadersInit) => new Headers({
  Authorization: basicAuthorization(credentials.username, credentials.password),
  'X-Requested-With': 'XMLHttpRequest',
  ...extra,
})

async function davFetch(credentials: NextcloudCredentials, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, headers: davHeaders(credentials, init.headers), mode: 'cors', cache: 'no-store' })
  } catch {
    throw new Error('Nextcloud non è raggiungibile. Autorizza l’origine di TournaManager nella sezione WebDAV/CalDAV di WebAppPassword.')
  }
}

const responseError = (status: number) => {
  if (status === 401) return new Error('Password applicativa Nextcloud non valida.')
  if (status === 403) return new Error('L’account Nextcloud non dispone dei permessi necessari.')
  if (status === 404) return new Error('La risorsa o l’API Nextcloud richiesta non è disponibile.')
  return new Error(`Nextcloud ha risposto con errore ${status}.`)
}

async function verifyCredentials(credentials: NextcloudCredentials) {
  const response = await davFetch(credentials, filesRootUrl(credentials), {
    method: 'PROPFIND',
    headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
  })
  if (response.status === 401 || response.status === 403) throw new Error('Password applicativa non valida per questo account Nextcloud.')
  if (response.status !== 207 && !response.ok) throw responseError(response.status)
}

async function ensureFolder(credentials: NextcloudCredentials, remotePath: string) {
  const url = davUrl(credentials, remotePath)
  const properties = await davFetch(credentials, url, {
    method: 'PROPFIND',
    headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
  })
  if (properties.status === 207 || properties.ok) return
  if (properties.status !== 404) throw responseError(properties.status)
  const created = await davFetch(credentials, url, { method: 'MKCOL' })
  if (!created.ok && created.status !== 405) throw responseError(created.status)
}

async function upload(credentials: NextcloudCredentials, remotePath: string, snapshot: PublicSnapshot, create = false) {
  const response = await davFetch(credentials, davUrl(credentials, remotePath), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(create ? { 'If-None-Match': '*' } : {}) },
    body: JSON.stringify(snapshot),
  })
  if (!response.ok) throw responseError(response.status)
}

const sharingUrl = (credentials: NextcloudCredentials, shareId?: string) => `${credentials.baseUrl}/index.php/apps/webapppassword/api/v1/shares${shareId ? `/${encodeURIComponent(shareId)}` : ''}`

async function sharingFetch<T>(credentials: NextcloudCredentials, url: string, init: RequestInit = {}, dataOptional = false): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: new Headers({
        Authorization: basicAuthorization(credentials.username, credentials.password),
        'OCS-APIRequest': 'true',
        Accept: 'application/json',
        ...init.headers,
      }),
      mode: 'cors', cache: 'no-store',
    })
  } catch {
    throw new Error('L’API condivisioni di WebAppPassword non è raggiungibile. Autorizza l’origine di TournaManager anche in “Files sharing API”.')
  }
  if (!response.ok) {
    if (dataOptional && response.status === 404) return undefined as T
    if (response.status === 404) throw new Error('L’API condivisioni di WebAppPassword non è disponibile su questo Nextcloud.')
    throw responseError(response.status)
  }
  const text = await response.text()
  if (!text.trim()) {
    if (dataOptional) return undefined as T
    throw new Error('Nextcloud non ha restituito una risposta OCS valida.')
  }
  let envelope: OcsEnvelope<T>
  try { envelope = JSON.parse(text) as OcsEnvelope<T> }
  catch { throw new Error('Nextcloud non ha restituito una risposta OCS valida.') }
  const meta = envelope.ocs?.meta
  const statusCode = Number(meta?.statuscode ?? response.status)
  if (meta?.status === 'failure' || statusCode >= 400) {
    if (dataOptional && statusCode === 404) return undefined as T
    throw new Error(meta?.message?.trim() || responseError(statusCode).message)
  }
  if (envelope.ocs?.data === undefined) {
    if (dataOptional) return undefined as T
    throw new Error('La risposta OCS di Nextcloud non contiene i dati richiesti.')
  }
  return envelope.ocs.data
}

const normalizeCredentials = (credentials: NextcloudCredentials): NextcloudCredentials => {
  const baseUrl = normalizeNextcloudBaseUrl(credentials.baseUrl)
  const username = credentials.username.trim()
  if (!username || !credentials.password) throw new Error('Inserisci indirizzo, nome utente e password applicativa Nextcloud.')
  return { ...credentials, baseUrl, username }
}

export async function createNextcloudPublication(credentials: NextcloudCredentials, fileName: string, snapshot: PublicSnapshot): Promise<NextcloudPublication> {
  const connection = normalizeCredentials(credentials)
  const remotePath = `/TournaManager/${fileName}`
  await verifyCredentials(connection)
  await ensureFolder(connection, '/TournaManager')
  await upload(connection, remotePath, snapshot, true)
  try {
    const data = await sharingFetch<RawShare>(connection, `${sharingUrl(connection)}?format=json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ path: remotePath, shareType: '3', permissions: '1' }),
    })
    if (data.id === undefined) throw new Error('Nextcloud ha creato una condivisione non riconoscibile.')
    const shareUrl = data.url?.trim() || (data.token ? `${connection.baseUrl}/index.php/s/${encodeURIComponent(data.token)}` : '')
    if (!shareUrl) throw new Error('Nextcloud non ha restituito il collegamento pubblico.')
    return {
      baseUrl: connection.baseUrl,
      username: connection.username,
      remotePath,
      shareId: String(data.id),
      shareUrl,
      publicDataUrl: publicNextcloudDataUrl(connection.baseUrl, shareUrl, data.token),
    }
  } catch (error) {
    await davFetch(connection, davUrl(connection, remotePath), { method: 'DELETE' }).catch(() => undefined)
    throw error
  }
}

export const updateNextcloudPublication = (credentials: NextcloudCredentials, publication: NextcloudPublication, snapshot: PublicSnapshot) => {
  const connection = normalizeCredentials({ ...credentials, baseUrl: publication.baseUrl, username: publication.username })
  return upload(connection, publication.remotePath, snapshot)
}

export async function destroyNextcloudPublication(credentials: NextcloudCredentials, publication: NextcloudPublication): Promise<string[]> {
  const connection = normalizeCredentials({ ...credentials, baseUrl: publication.baseUrl, username: publication.username })
  const warnings: string[] = []
  try {
    await sharingFetch<unknown>(connection, `${sharingUrl(connection, publication.shareId)}?format=json`, { method: 'DELETE' }, true)
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Impossibile eliminare la condivisione remota.')
  }
  try {
    const response = await davFetch(connection, davUrl(connection, publication.remotePath), { method: 'DELETE' })
    if (!response.ok && response.status !== 404) throw responseError(response.status)
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Impossibile eliminare il file remoto.')
  }
  return warnings
}
