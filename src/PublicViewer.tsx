import { useEffect, useState } from 'react'
import { CircleDot, RefreshCw, Trophy } from 'lucide-react'
import { formatMinute } from './engine/core'
import type { PublicSnapshot } from './publicSnapshot'
import { scrollToTournament, TournamentRows } from './TournamentRows'
import { MatchSetScores } from './MatchSetScores'
import { ClubColorsProvider, TeamName } from './TeamName'
import { tournamentTheme } from './tournamentColors'

const validSnapshot = (value: unknown): value is PublicSnapshot => typeof value === 'object' && value !== null && (value as PublicSnapshot).app === 'tournamanager-live' && (value as PublicSnapshot).version === 1
const REFRESH_COOLDOWN_MS = 15_000

export function PublicViewer({ source }: { source: string }) {
  const access = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const viewerUsername = access.get('user') ?? ''
  const viewerPassword = access.get('password') ?? ''
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let active = true
    const refresh = async () => {
      setLoading(true)
      try {
        if (!viewerUsername || !viewerPassword) throw new Error('il link non contiene le credenziali dell’account pubblico')
        const bytes = new TextEncoder().encode(`${viewerUsername}:${viewerPassword}`)
        let binary = ''
        bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
        const response = await fetch(source, { mode: 'cors', cache: 'no-store', headers: { Authorization: `Basic ${btoa(binary)}`, 'X-Requested-With': 'XMLHttpRequest' } })
        if (!response.ok) throw new Error(`Nextcloud ha risposto ${response.status}`)
        const value: unknown = await response.json()
        if (!validSnapshot(value)) throw new Error('il file condiviso non contiene uno stato TournaManager valido')
        if (active) { setSnapshot(value); setError('') }
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
  }, [source, viewerUsername, viewerPassword, refreshVersion])

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

  const clubs = snapshot.clubs ?? [...snapshot.playing, ...snapshot.results].flatMap((match) => [match.teamAClub ?? '', match.teamBClub ?? '']).concat(snapshot.standings.flatMap((section) => section.rows.map((row) => row.club ?? '')))
  return <ClubColorsProvider clubs={clubs}><main className="public-view">
    <header className="public-header"><div className="brand"><span className="brand-mark"><Trophy size={21} /></span><span>Tourna<strong>Manager</strong></span></div><div><span className="eyebrow">Risultati dal vivo</span><h1>{snapshot.tournamentName}</h1><p>{snapshot.date} · aggiornato alle {new Date(snapshot.updatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p></div>{refreshButton}</header>
    {error && <p className="public-warning">Connessione momentaneamente assente: sto mostrando l’ultimo aggiornamento ricevuto.</p>}
    <nav className="public-tournaments" aria-label="Vai al torneo">{snapshot.tournaments.map((tournament, index) => <button style={tournamentTheme(tournament.color, index)} onClick={() => scrollToTournament('public-tournament', tournament.id)} key={tournament.id}><strong>{tournament.label}</strong><span>{tournament.completed}/{tournament.total} concluse</span></button>)}</nav>
    <TournamentRows tournaments={snapshot.tournaments} prefix="public-tournament" headerContent={(tournament) => {
      const phaseNames = [...new Set(snapshot.standings.filter((section) => section.tournamentId === tournament.id).map((section) => section.phaseName))]
      return phaseNames.length ? <p>Fase attuale · {phaseNames.join(' · ')}</p> : null
    }}>{(tournament) => {
      const playing = snapshot.playing.filter((match) => match.tournamentId === tournament.id)
      const results = snapshot.results.filter((match) => match.tournamentId === tournament.id)
      const standings = snapshot.standings.filter((section) => section.tournamentId === tournament.id)
      return <>
    <section className="public-section"><div className="public-title"><CircleDot size={18} /><div><span className="eyebrow">Adesso</span><h2>Partite in campo</h2></div></div>{playing.length ? <div className="public-live-grid">{playing.map((match) => <article key={match.id}><header><span>Campo {match.court}</span><small>{match.phaseName}</small></header><div><strong><TeamName name={match.teamA} club={match.teamAClub} /></strong><b>VS</b><strong><TeamName name={match.teamB} club={match.teamBClub} /></strong></div></article>)}</div> : <p className="public-empty">Nessuna partita attualmente in campo.</p>}</section>
    {standings.map((section) => <section className="public-section public-standing" key={section.id}><div className="public-title"><h2>{section.title}</h2></div><div className="phase-standings"><table><thead><tr><th>#</th><th>Squadra</th><th>G</th><th>V</th><th>N</th><th>PT</th><th>Set</th><th>Punti</th></tr></thead><tbody>{section.rows.map((row, index) => <tr key={row.teamId}><td><strong className="rank">{index + 1}</strong></td><td><strong><TeamName name={row.teamName} club={row.club} /></strong></td><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td><strong>{row.tablePoints}</strong></td><td>{row.setsWon}:{row.setsLost}</td><td>{row.pointsFor}:{row.pointsAgainst}</td></tr>)}</tbody></table></div></section>)}
    <section className="public-section"><div className="public-title"><div><span className="eyebrow">Ultimi aggiornamenti</span><h2>Risultati</h2></div></div>{results.length ? <div className="public-results">{results.map((match) => <article key={match.id}><time>{formatMinute(match.startMinute)}</time><small>{match.phaseName}</small><strong><TeamName name={match.teamA} club={match.teamAClub} /></strong><MatchSetScores sets={match.sets} /><strong><TeamName name={match.teamB} club={match.teamBClub} /></strong></article>)}</div> : <p className="public-empty">Non ci sono ancora risultati.</p>}</section>
      </>
    }}</TournamentRows>
  </main></ClubColorsProvider>
}
