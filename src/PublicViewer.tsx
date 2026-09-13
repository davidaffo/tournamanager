import { useEffect, useState } from 'react'
import { CircleDot, RefreshCw, Trophy } from 'lucide-react'
import { formatMinute } from './engine/core'
import { publicSetResult, type PublicSnapshot } from './publicSnapshot'

const validSnapshot = (value: unknown): value is PublicSnapshot => typeof value === 'object' && value !== null && (value as PublicSnapshot).app === 'tournamanager-live' && (value as PublicSnapshot).version === 1
const REFRESH_COOLDOWN_MS = 15_000

export function PublicViewer({ source }: { source: string }) {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null)
  const [error, setError] = useState('')
  const [selectedTournament, setSelectedTournament] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let active = true
    const refresh = async () => {
      setLoading(true)
      try {
        const response = await fetch(source, { mode: 'cors', cache: 'no-store' })
        if (!response.ok) throw new Error(`Nextcloud ha risposto ${response.status}`)
        const value: unknown = await response.json()
        if (!validSnapshot(value)) throw new Error('il file condiviso non contiene uno stato TournaManager valido')
        if (active) { setSnapshot(value); setError(''); setSelectedTournament((current) => current || value.tournaments[0]?.id || '') }
      } catch (error) {
        const detail = error instanceof Error && error.message ? ` ${error.message}.` : ''
        if (active) setError(`Impossibile leggere lo stato del torneo.${detail}`)
      } finally {
        if (active) {
          const until = Date.now() + REFRESH_COOLDOWN_MS
          setLoading(false)
          setCooldownUntil(until)
          setNow(Date.now())
        }
      }
    }
    refresh()
    return () => { active = false }
  }, [source, refreshVersion])

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const interval = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= cooldownUntil) window.clearInterval(interval)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [cooldownUntil])

  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
  const refreshButton = <button className="button secondary public-refresh" disabled={loading || cooldownSeconds > 0} onClick={() => setRefreshVersion((value) => value + 1)}><RefreshCw className={loading ? 'spin' : ''} size={15} /> {loading ? 'Aggiornamento…' : cooldownSeconds ? `Riprova tra ${cooldownSeconds}s` : snapshot ? 'Aggiorna' : 'Riprova'}</button>

  if (!snapshot) return <main className="public-view public-loading"><RefreshCw className={loading ? 'spin' : ''} size={28} /><h1>TournaManager</h1><p>{error || 'Caricamento del torneo…'}</p>{error && refreshButton}</main>
  const tournamentId = snapshot.tournaments.some((item) => item.id === selectedTournament) ? selectedTournament : snapshot.tournaments[0]?.id
  const playing = snapshot.playing.filter((match) => match.tournamentId === tournamentId)
  const results = snapshot.results.filter((match) => match.tournamentId === tournamentId)
  const standings = snapshot.standings.filter((section) => section.tournamentId === tournamentId)

  return <main className="public-view">
    <header className="public-header"><div className="brand"><span className="brand-mark"><Trophy size={21} /></span><span>Tourna<strong>Manager</strong></span></div><div><span className="eyebrow">Risultati dal vivo</span><h1>{snapshot.tournamentName}</h1><p>{snapshot.date} · aggiornato alle {new Date(snapshot.updatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p></div>{refreshButton}</header>
    {error && <p className="public-warning">Connessione momentaneamente assente: sto mostrando l’ultimo aggiornamento ricevuto.</p>}
    <nav className="public-tournaments">{snapshot.tournaments.map((tournament) => <button className={tournament.id === tournamentId ? 'active' : ''} onClick={() => setSelectedTournament(tournament.id)} key={tournament.id}><strong>{tournament.label}</strong><span>{tournament.completed}/{tournament.total} concluse</span></button>)}</nav>
    <section className="public-section"><div className="public-title"><CircleDot size={18} /><div><span className="eyebrow">Adesso</span><h2>Partite in campo</h2></div></div>{playing.length ? <div className="public-live-grid">{playing.map((match) => <article key={match.id}><header><span>Campo {match.court}</span><small>{match.phaseName}</small></header><div><strong>{match.teamA}</strong><b>VS</b><strong>{match.teamB}</strong></div></article>)}</div> : <p className="public-empty">Nessuna partita attualmente in campo.</p>}</section>
    {standings.map((section) => <section className="public-section public-standing" key={section.id}><div className="public-title"><div><span className="eyebrow">{section.tournamentLabel} · {section.phaseName}</span><h2>{section.title}</h2></div></div><div className="phase-standings"><table><thead><tr><th>#</th><th>Squadra</th><th>G</th><th>V</th><th>N</th><th>PT</th><th>Set</th><th>Punti</th></tr></thead><tbody>{section.rows.map((row, index) => <tr key={row.teamId}><td><strong className="rank">{index + 1}</strong></td><td><strong>{row.teamName}</strong></td><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td><strong>{row.tablePoints}</strong></td><td>{row.setsWon}:{row.setsLost}</td><td>{row.pointsFor}:{row.pointsAgainst}</td></tr>)}</tbody></table></div></section>)}
    <section className="public-section"><div className="public-title"><div><span className="eyebrow">Ultimi aggiornamenti</span><h2>Risultati</h2></div></div>{results.length ? <div className="public-results">{results.map((match) => <article key={match.id}><time>{formatMinute(match.startMinute)}</time><small>{match.phaseName}</small><strong>{match.teamA}</strong><b>{publicSetResult(match.sets)}</b><strong>{match.teamB}</strong></article>)}</div> : <p className="public-empty">Non ci sono ancora risultati.</p>}</section>
  </main>
}
