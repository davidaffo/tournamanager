import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, ExternalLink, Maximize2, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import QRCode from 'qrcode'
import { createNextcloudPublication, destroyNextcloudPublication, publicNextcloudDataUrl, updateNextcloudPublication, type NextcloudPublication } from './nextcloud'
import { loadPublicBridge } from './publicBridge'
import type { PublicSnapshot } from './publicSnapshot'

const STORAGE_KEY = 'tournamanager-nextcloud'
const DEV_LINK_TARGET_KEY = 'tournamanager-dev-link-target'
const PAGES_URL = 'https://davidaffo.github.io/tournamanager/'
type StoredSettings = { baseUrl: string; username: string; publication: NextcloudPublication | null }

const loadSettings = (): StoredSettings => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as StoredSettings
    return { baseUrl: value.baseUrl ?? '', username: value.username ?? '', publication: value.publication ?? null }
  } catch { return { baseUrl: '', username: '', publication: null } }
}

const fileSlug = (value: string) => value.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'torneo'

export function NextcloudPublisher({ snapshot }: { snapshot: PublicSnapshot }) {
  const initial = useMemo(loadSettings, [])
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [username, setUsername] = useState(initial.username)
  const [password, setPassword] = useState('')
  const [publication, setPublication] = useState<NextcloudPublication | null>(initial.publication)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(initial.publication ? 'Inserisci la password per riprendere la sincronizzazione.' : '')
  const [synced, setSynced] = useState(false)
  const [qrCode, setQrCode] = useState('')
  const [showLargeQr, setShowLargeQr] = useState(false)
  const [devLinkTarget, setDevLinkTarget] = useState<'pages' | 'local'>(() => localStorage.getItem(DEV_LINK_TARGET_KEY) === 'local' ? 'local' : 'pages')

  const credentials = { baseUrl, username, password }
  const viewerUrl = useMemo(() => {
    if (!publication) return ''
    const url = new URL(import.meta.env.DEV && devLinkTarget === 'pages' ? PAGES_URL : window.location.href)
    url.search = ''
    url.hash = ''
    let publicDataUrl = publication.publicDataUrl
    try { publicDataUrl = publicNextcloudDataUrl(publication.baseUrl, publication.shareUrl) }
    catch { /* Il valore salvato resta l'ultima risorsa utilizzabile. */ }
    url.searchParams.set('live', publicDataUrl)
    return url.toString()
  }, [publication, devLinkTarget])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl, username, publication }))
  }, [baseUrl, username, publication])

  useEffect(() => {
    if (import.meta.env.DEV) localStorage.setItem(DEV_LINK_TARGET_KEY, devLinkTarget)
  }, [devLinkTarget])

  useEffect(() => {
    let active = true
    if (!viewerUrl) { setQrCode(''); return }
    QRCode.toDataURL(viewerUrl, { width: 900, margin: 3, errorCorrectionLevel: 'M', color: { dark: '#111d1a', light: '#ffffff' } })
      .then((value) => { if (active) setQrCode(value) })
      .catch(() => { if (active) setStatus('Impossibile generare il QR del collegamento pubblico.') })
    return () => { active = false }
  }, [viewerUrl])

  useEffect(() => {
    if (!showLargeQr) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowLargeQr(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [showLargeQr])

  useEffect(() => {
    if (!publication || !password) return
    setSynced(false)
    const timeout = window.setTimeout(async () => {
      try {
        await updateNextcloudPublication(credentials, publication, snapshot)
        setSynced(true)
        setStatus(`Aggiornato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Sincronizzazione Nextcloud non riuscita.')
      }
    }, 800)
    return () => window.clearTimeout(timeout)
  }, [publication, password, snapshot])

  const publish = async () => {
    setBusy(true); setStatus('Creazione del file pubblico…')
    try {
      const suffix = crypto.randomUUID().slice(0, 8)
      const created = await createNextcloudPublication(credentials, `${fileSlug(snapshot.tournamentName)}-${suffix}.live.js`, snapshot)
      setPublication(created)
      setBaseUrl(created.baseUrl)
      setUsername(created.username)
      const publicValue = await loadPublicBridge(created.publicDataUrl)
      if (typeof publicValue !== 'object' || publicValue === null || (publicValue as PublicSnapshot).app !== 'tournamanager-live') {
        throw new Error('Nextcloud ha pubblicato il file, ma il browser non ha ricevuto uno stato TournaManager valido.')
      }
      setSynced(true)
      setStatus('Pubblicazione attiva e verificata dal browser.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Pubblicazione Nextcloud non riuscita. Controlla anche la configurazione CORS del server.')
    } finally { setBusy(false) }
  }

  const updateNow = async () => {
    if (!publication) return
    setBusy(true); setStatus('Aggiornamento…')
    try {
      await updateNextcloudPublication(credentials, publication, snapshot)
      setSynced(true); setStatus('File aggiornato.')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Aggiornamento non riuscito.') }
    finally { setBusy(false) }
  }

  const destroy = async () => {
    if (!publication || !window.confirm('Terminare la pubblicazione ed eliminare definitivamente il file da Nextcloud?')) return
    const target = publication
    setPublication(null)
    setSynced(false)
    setBusy(true); setStatus('Eliminazione della pubblicazione…')
    try {
      const warnings = await destroyNextcloudPublication(credentials, target)
      setStatus(warnings.length ? `Pubblicazione rimossa dall’app. Nextcloud segnala: ${warnings.join(' ')}` : 'File e condivisione eliminati da Nextcloud.')
    } catch (error) {
      setStatus(`Pubblicazione rimossa dall’app. ${error instanceof Error ? error.message : 'Non è stato possibile verificare la pulizia su Nextcloud.'}`)
    }
    finally { setBusy(false) }
  }

  const copyViewerUrl = async () => {
    try { await navigator.clipboard.writeText(viewerUrl); setStatus('Link pubblico copiato.') }
    catch { setStatus('Copia il link pubblico dal campo.') }
  }

  return <section className="nextcloud-panel panel">
    <header><div><span className="eyebrow">Pubblico</span><h3>Pubblicazione Nextcloud</h3><p>Partite in corso, risultati e classifiche aggiornati automaticamente.</p></div>{publication && <b className={synced ? 'online' : ''}><i /> {synced ? 'Sincronizzato' : 'Da collegare'}</b>}</header>
    <div className="nextcloud-fields">
      <label className="field"><span>Indirizzo Nextcloud</span><input type="url" placeholder="https://cloud.esempio.it" value={baseUrl} disabled={Boolean(publication)} onChange={(event) => setBaseUrl(event.target.value)} /></label>
      <label className="field"><span>Nome utente</span><input autoComplete="username" value={username} disabled={Boolean(publication)} onChange={(event) => setUsername(event.target.value)} /></label>
      <label className="field"><span>Password per app</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    </div>
    {import.meta.env.DEV && <label className="field dev-link-target"><span>Destinazione del link pubblico e del QR</span><select value={devLinkTarget} onChange={(event) => setDevLinkTarget(event.target.value as 'pages' | 'local')}><option value="pages">GitHub Pages · apribile dagli smartphone</option><option value="local">Localhost · solo sviluppo locale</option></select></label>}
    {!publication ? <div className="nextcloud-actions"><button className="button dark" disabled={busy || !baseUrl.trim() || !username.trim() || !password} onClick={publish}><Upload size={16} /> Crea pubblicazione</button></div> : <>
      <div className="publication-qr"><div>{qrCode ? <img src={qrCode} alt="QR code del torneo pubblico" /> : <RefreshCw className="spin" size={24} />}</div><section><h4>QR per il pubblico</h4><p>Inquadralo per aprire risultati e classifiche sullo smartphone.</p>{qrCode && <div className="qr-actions"><button className="button dark" onClick={() => setShowLargeQr(true)}><Maximize2 size={15} /> Mostra grande</button><a className="button secondary" href={qrCode} download={`${fileSlug(snapshot.tournamentName)}-qr.png`}><Download size={15} /> Scarica QR</a></div>}</section></div>
      <div className="public-link"><label><span>Link per il pubblico</span><input readOnly value={viewerUrl} /></label><button className="button secondary" onClick={copyViewerUrl}><Copy size={15} /> Copia</button><a className="button secondary" href={viewerUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Apri</a></div>
      <div className="nextcloud-actions"><button className="button secondary" disabled={busy || !password} onClick={updateNow}><RefreshCw size={15} /> Aggiorna ora</button><button className="button danger" disabled={busy} onClick={destroy}><Trash2 size={15} /> Termina ed elimina il file</button></div>
    </>}
    {status && <p className="nextcloud-status">{synced && <Check size={13} />} {status}</p>}
    <small>Indirizzo e utente vengono ricordati. La password non viene salvata. In WebAppPassword autorizza <code>{window.location.origin}</code> sia per WebDAV/CalDAV sia per Files sharing API.</small>
    {showLargeQr && qrCode && <div className="qr-projector" role="dialog" aria-modal="true" aria-label="QR del torneo" onClick={() => setShowLargeQr(false)}><button aria-label="Chiudi QR" onClick={() => setShowLargeQr(false)}><X size={28} /></button><div onClick={(event) => event.stopPropagation()}><span>TournaManager</span><h2>{snapshot.tournamentName}</h2><img src={qrCode} alt="QR code del torneo pubblico ingrandito" /><p>Inquadra il QR per seguire risultati e classifiche</p></div></div>}
  </section>
}
