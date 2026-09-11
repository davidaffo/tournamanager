import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3, CalendarDays, Check, ChevronRight, CircleDot, ClipboardList, Clock3,
  GitBranch, LayoutDashboard, MapPin, Monitor, Moon, Play, Plus, RotateCcw, Save, Settings2, Sun, Trash2, Trophy, Users, X,
} from 'lucide-react'
import { calculateStandings, estimateMatchMinutes, formatMinute, generateMatches, getSetWinner, getSuggestions, nextReadyMatch, parseTeams, resolveParticipantId, toMinute } from './engine/core'
import { demoTeamNames } from './engine/demo'
import type { FormatKind, GroupComposition, Match, SetScore, Team, TournamentConfig, TournamentPhase, TournamentState, TournamentType } from './engine/types'

type View = 'design' | 'structure' | 'schedule' | 'control' | 'standings'
type ThemeMode = 'light' | 'dark' | 'system'

const defaultConfig: TournamentConfig = {
  name: 'Volley Day 2026',
  date: '2026-09-20',
  startTime: '09:00',
  endTime: '20:00',
  courts: 4,
  tournamentType: 's3',
  setsPerMatch: 2,
  pointsPerSet: 21,
  phaseBreakMinutes: 15,
  groupCount: 4,
  finalTeams: 8,
  thirdPlaceFinal: true,
}

const STATE_KEY = 'torunamanager-state-v1'
const LEGACY_STATE_KEYS = ['tournamanager-state-v1', 'tornei-live-state-v1']
const THEME_KEY = 'torunamanager-theme'
const LEGACY_THEME_KEYS = ['tournamanager-theme', 'tornei-live-theme']

const makeInitialState = (): TournamentState => {
  const saved = localStorage.getItem(STATE_KEY) ?? LEGACY_STATE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean)
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as TournamentState
      const config = {
        ...parsed.config,
        tournamentType: parsed.config.tournamentType ?? 's3',
        setsPerMatch: parsed.config.setsPerMatch ?? 2,
        pointsPerSet: parsed.config.pointsPerSet ?? 21,
        phaseBreakMinutes: parsed.config.phaseBreakMinutes ?? 15,
        groupCount: parsed.config.groupCount ?? 4,
        finalTeams: parsed.config.finalTeams ?? 8,
        thirdPlaceFinal: parsed.config.thirdPlaceFinal ?? true,
      }
      const previousFormatWasRemoved = String(parsed.selectedFormat) === 'balanced'
      return {
        ...parsed,
        selectedFormat: previousFormatWasRemoved ? 'groups' : parsed.selectedFormat,
        config,
        phases: parsed.phases?.length ? parsed.phases.map((phase) => ({ ...phase, groupComposition: phase.groupComposition ?? 'strength', advanceAll: phase.advanceAll ?? false })) : getSuggestions(parsed.teams.length, config).find((item) => item.id === (previousFormatWasRemoved ? 'groups' : parsed.selectedFormat))?.phases ?? [],
        matches: (previousFormatWasRemoved ? generateMatches(parsed.teams, config, 'groups') : parsed.matches).map((match) => ({
          ...match,
          status: String(match.status) === 'called' ? 'playing' : match.status,
        })),
      }
    } catch { /* use defaults */ }
  }
  const teams = import.meta.env.DEV ? parseTeams(demoTeamNames.join('\n')) : []
  return {
    config: defaultConfig,
    teams,
    selectedFormat: 'groups',
    phases: getSuggestions(teams.length, defaultConfig)[0]?.phases ?? [],
    matches: [],
  }
}

const navItems: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'design', label: 'Progetta', icon: LayoutDashboard },
  { id: 'structure', label: 'Struttura', icon: GitBranch },
  { id: 'schedule', label: 'Calendario', icon: CalendarDays },
  { id: 'control', label: 'Regia live', icon: CircleDot },
  { id: 'standings', label: 'Classifiche', icon: BarChart3 },
]

function NumberField({ label, value, onChange, suffix, min = 0 }: { label: string; value: number; onChange: (value: number) => void; suffix?: string; min?: number }) {
  return <label className="field compact-field">
    <span>{label}</span>
    <div className="number-wrap">
      <input type="number" min={min} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      {suffix && <small>{suffix}</small>}
    </div>
  </label>
}

function Metric({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return <div className={`metric ${tone ?? ''}`}><strong>{value}</strong><span>{label}</span></div>
}

function TeamBadge({ team }: { team?: Team }) {
  if (!team) return <span className="team-name muted">Da definire</span>
  return <span className="team-name"><i>{team.name.slice(0, 2).toUpperCase()}</i>{team.name}</span>
}

function participantLabel(source: string, matches: Match[], teamById: Map<string, Team>) {
  const resolved = resolveParticipantId(source, matches)
  if (resolved) return teamById.get(resolved)?.name ?? resolved
  const reference = source.match(/^(winner|loser):match-(\d+)$/)
  if (reference) return `${reference[1] === 'winner' ? 'Vincente' : 'Perdente'} partita ${reference[2]}`
  const rankReference = source.match(/^rank:pool-([^:]+):(\d+)$/)
  if (rankReference) return `${rankReference[2]}ª Girone ${rankReference[1]}`
  return 'Da definire'
}

function ParticipantBadge({ source, matches, teamById }: { source: string; matches: Match[]; teamById: Map<string, Team> }) {
  const resolved = resolveParticipantId(source, matches)
  const team = resolved ? teamById.get(resolved) : undefined
  return team ? <TeamBadge team={team} /> : <span className="team-name muted">{participantLabel(source, matches, teamById)}</span>
}

function ResultEditor({ match, matches, teams, config, onSave, onClose }: { match: Match; matches: Match[]; teams: Team[]; config: TournamentConfig; onSave: (sets: SetScore[]) => void; onClose: () => void }) {
  const [sets, setSets] = useState<SetScore[]>(match.sets.length ? match.sets : Array.from({ length: config.setsPerMatch }, (_, index) => ({ a: config.pointsPerSet, b: Math.max(0, config.pointsPerSet - 3 - index) })))
  const teamA = teams.find((team) => team.id === resolveParticipantId(match.teamAId, matches))
  const teamB = teams.find((team) => team.id === resolveParticipantId(match.teamBId, matches))
  const result = getSetWinner(sets)
  const update = (index: number, side: 'a' | 'b', value: number) => setSets((current) => current.map((set, i) => i === index ? { ...set, [side]: Math.max(0, value) } : set))
  return <div className="scrim" onMouseDown={onClose}>
    <section className="result-modal" onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-button close" onClick={onClose} aria-label="Chiudi"><X size={20} /></button>
      <div className="eyebrow">Risultato · Campo {match.court}</div>
      <h2>Inserisci il risultato</h2>
      <div className="score-head">
        <TeamBadge team={teamA} /><strong>{result.a} – {result.b}</strong><TeamBadge team={teamB} />
      </div>
      <div className="set-list">
        {sets.map((set, index) => <div className="set-row" key={index}>
          <span>Set {index + 1}</span>
          <input aria-label={`Punti ${teamA?.name} set ${index + 1}`} type="number" value={set.a} onChange={(event) => update(index, 'a', Number(event.target.value))} />
          <span>–</span>
          <input aria-label={`Punti ${teamB?.name} set ${index + 1}`} type="number" value={set.b} onChange={(event) => update(index, 'b', Number(event.target.value))} />
          {sets.length > 1 && <button className="icon-button" onClick={() => setSets((current) => current.filter((_, i) => i !== index))}><X size={16} /></button>}
        </div>)}
      </div>
      <button className="text-button" onClick={() => setSets((current) => [...current, { a: 15, b: 12 }])}><Plus size={16} /> Aggiungi set</button>
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>Annulla</button>
        <button className="button primary" disabled={!result.winner} onClick={() => onSave(sets)}><Check size={18} /> Salva risultato</button>
      </div>
    </section>
  </div>
}

export default function App() {
  const [state, setState] = useState<TournamentState>(makeInitialState)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY) ?? LEGACY_THEME_KEYS.map((key) => localStorage.getItem(key)).find(Boolean)
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
  })
  const [view, setView] = useState<View>('design')
  const [teamText, setTeamText] = useState(() => makeInitialState().teams.map((team) => team.name).join('\n'))
  const [editingMatch, setEditingMatch] = useState<Match | null>(null)
  const [poolFilter, setPoolFilter] = useState('all')
  const { config, teams, matches, selectedFormat, phases } = state
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams])
  const completed = matches.filter((match) => match.status === 'completed').length
  const nextMatch = nextReadyMatch(matches)
  let nextPhaseEntrants = teams.length
  const phaseEntrants = phases.map((phase) => {
    const entrants = nextPhaseEntrants
    nextPhaseEntrants = phase.format === 'groups' ? (phase.advanceAll ? entrants : phase.advancingTeams > 0 ? phase.advancingTeams : entrants) : 1
    return entrants
  })
  const customFormulaValid = phases.length > 0 && phases.every((phase, index) => {
    const entrants = phaseEntrants[index]
    if (phase.format === 'knockout') return index === phases.length - 1 && entrants >= 2
    const groupsValid = phase.groupCount >= 1 && phase.groupCount <= Math.max(1, Math.floor(entrants / 2))
    if (index === phases.length - 1) return groupsValid
    return groupsValid && (phase.advanceAll || (phase.advancingTeams >= phase.groupCount && phase.advancingTeams <= entrants && phase.advancingTeams % phase.groupCount === 0))
  })
  const customPreviewMatches = useMemo(
    () => teams.length > 1 && customFormulaValid ? generateMatches(teams, config, phases[0]?.format ?? 'groups', phases) : [],
    [teams, config, phases, customFormulaValid],
  )
  const customMatchCount = customPreviewMatches.length
  const estimatedEndMinute = customPreviewMatches.length ? Math.max(...customPreviewMatches.map((match) => match.endMinute)) : toMinute(config.startTime)
  const deadlineMinute = toMinute(config.endTime)
  const overTime = customFormulaValid && estimatedEndMinute > deadlineMinute
  const overtimeMinutes = Math.max(0, estimatedEndMinute - deadlineMinute)
  const suggestedGroups = new Map<string, number>()
  if (overTime) phases.forEach((phase, phaseIndex) => {
    if (phase.format !== 'groups') return
    const entrants = phaseEntrants[phaseIndex]
    const candidates = Array.from({ length: Math.max(1, Math.floor(entrants / 2)) }, (_, index) => index + 1)
      .filter((count) => count !== phase.groupCount && (phase.advanceAll || phaseIndex === phases.length - 1 || phase.advancingTeams % count === 0))
      .map((count) => {
        const candidatePhases = phases.map((item) => item.id === phase.id ? { ...item, groupCount: count } : item)
        const candidateMatches = generateMatches(teams, config, candidatePhases[0]?.format ?? 'groups', candidatePhases)
        const candidateEnd = candidateMatches.length ? Math.max(...candidateMatches.map((match) => match.endMinute)) : toMinute(config.startTime)
        return { count, candidateEnd }
      })
      .filter((candidate) => candidate.candidateEnd < estimatedEndMinute)
      .sort((a, b) => {
        const aFits = a.candidateEnd <= deadlineMinute
        const bFits = b.candidateEnd <= deadlineMinute
        if (aFits !== bFits) return aFits ? -1 : 1
        if (aFits) return Math.abs(a.count - phase.groupCount) - Math.abs(b.count - phase.groupCount) || b.candidateEnd - a.candidateEnd
        return a.candidateEnd - b.candidateEnd || Math.abs(a.count - phase.groupCount) - Math.abs(b.count - phase.groupCount)
      })
    if (candidates[0]) suggestedGroups.set(phase.id, candidates[0].count)
  })
  const phaseAdditionSuggestions: Array<{ label: string; description: string; phase: TournamentPhase; estimatedEnd: number }> = []
  const lastPhase = phases.at(-1)
  if (customFormulaValid && !overTime && lastPhase?.format === 'groups' && teams.length > 1) {
    const entrants = phaseEntrants.at(-1) ?? teams.length
    const phasesWithAdvancement = phases.map((phase, index) => index === phases.length - 1 ? { ...phase, advanceAll: true, advancingTeams: entrants } : phase)
    const divisors = Array.from({ length: Math.max(1, Math.floor(entrants / 2)) }, (_, index) => index + 1).filter((count) => entrants % count === 0)
    const groupCount = divisors.sort((a, b) => Math.abs(entrants / a - 4) - Math.abs(entrants / b - 4))[0] ?? 1
    const groupPhases = phases.filter((phase) => phase.format === 'groups')
    const nextComposition: GroupComposition | null = groupPhases.length === 1 ? 'cross' : lastPhase.groupComposition === 'cross' ? 'strength' : null
    const candidates: Array<{ label: string; description: string; phase: TournamentPhase }> = []
    if (nextComposition) candidates.push({
      label: nextComposition === 'cross' ? 'Aggiungi gironi incrociati' : 'Aggiungi gironi finali per livello',
      description: nextComposition === 'cross' ? 'Mescola fasce alte e basse nella seconda fase.' : 'Raggruppa le squadre per livello per definire la classifica.',
      phase: { id: 'suggested-groups', name: nextComposition === 'cross' ? 'Gironi incrociati' : 'Gironi finali', format: 'groups', groupCount, groupComposition: nextComposition, advanceAll: true, advancingTeams: entrants, thirdPlaceFinal: false },
    })
    candidates.push({
      label: 'Aggiungi eliminazione diretta',
      description: `Crea un tabellone finale con tutte le ${entrants} squadre.`,
      phase: { id: 'suggested-knockout', name: 'Fase finale', format: 'knockout', groupCount: 1, groupComposition: 'strength', advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    })
    candidates.forEach((candidate) => {
      const candidatePhases = [...phasesWithAdvancement, candidate.phase]
      const candidateMatches = generateMatches(teams, config, candidatePhases[0]?.format ?? 'groups', candidatePhases)
      const candidateEnd = candidateMatches.length ? Math.max(...candidateMatches.map((match) => match.endMinute)) : estimatedEndMinute
      if (candidateEnd <= deadlineMinute) phaseAdditionSuggestions.push({ ...candidate, estimatedEnd: candidateEnd })
    })
  }

  useEffect(() => { localStorage.setItem(STATE_KEY, JSON.stringify(state)) }, [state])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    }
    applyTheme()
    localStorage.setItem(THEME_KEY, theme)
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  const updateConfig = <K extends keyof TournamentConfig>(key: K, value: TournamentConfig[K]) => {
    setState((current) => ({ ...current, config: { ...current.config, [key]: value } }))
  }
  const importTeamText = () => setState((current) => {
    const nextTeams = parseTeams(teamText)
    const nextPhases = getSuggestions(nextTeams.length, current.config)[0]?.phases ?? []
    return { ...current, teams: nextTeams, phases: nextPhases, matches: [] }
  })
  const createCustomTournament = () => {
    const first = phases[0]
    const groupPhase = phases.find((phase) => phase.format === 'groups')
    const finalPhase = phases.find((phase) => phase.format === 'knockout')
    const nextConfig = { ...config, groupCount: groupPhase?.groupCount ?? 1, finalTeams: finalPhase && groupPhase ? (groupPhase.advanceAll ? teams.length : groupPhase.advancingTeams) : 0, thirdPlaceFinal: finalPhase?.thirdPlaceFinal ?? false }
    setState((current) => ({ ...current, config: nextConfig, selectedFormat: first?.format ?? 'groups', matches: generateMatches(current.teams, nextConfig, first?.format ?? 'groups', current.phases) }))
    setView('structure')
  }
  const updatePhase = (id: string, patch: Partial<TournamentPhase>) => setState((current) => ({
    ...current, phases: current.phases.map((phase) => phase.id === id ? { ...phase, ...patch } : phase), matches: [],
  }))
  const removePhase = (id: string) => setState((current) => ({ ...current, phases: current.phases.filter((phase) => phase.id !== id), matches: [] }))
  const addPhase = () => setState((current) => {
    const lastIsKnockout = current.phases.at(-1)?.format === 'knockout'
    const insertionIndex = lastIsKnockout ? current.phases.length - 1 : current.phases.length
    let entrants = current.teams.length
    for (let index = 0; index < insertionIndex; index += 1) {
      const phase = current.phases[index]
      if (phase.format === 'groups' && phase.advancingTeams > 0) entrants = phase.advancingTeams
    }
    const divisors = Array.from({ length: Math.max(1, Math.floor(entrants / 2)) }, (_, index) => index + 1).filter((count) => entrants % count === 0)
    const groupCount = divisors.sort((a, b) => Math.abs(entrants / a - 4) - Math.abs(entrants / b - 4))[0] ?? 1
    const next: TournamentPhase = { id: `phase-${Date.now()}`, name: `Fase ${insertionIndex + 1}`, format: 'groups', groupCount, groupComposition: 'strength', advanceAll: true, advancingTeams: entrants, thirdPlaceFinal: false }
    const phases = [...current.phases]
    if (!lastIsKnockout && phases.length > 0) {
      const previous = phases[phases.length - 1]
      if (previous.format === 'groups' && previous.advancingTeams === 0) phases[phases.length - 1] = { ...previous, advanceAll: true, advancingTeams: entrants }
    }
    phases.splice(insertionIndex, 0, next)
    return { ...current, phases, matches: [] }
  })
  const applyPhaseSuggestion = (suggestedPhase: TournamentPhase) => setState((current) => {
    const previousIndex = current.phases.length - 1
    const entrants = phaseEntrants.at(-1) ?? current.teams.length
    const phases = current.phases.map((phase, index) => index === previousIndex && phase.format === 'groups' ? { ...phase, advanceAll: true, advancingTeams: entrants } : phase)
    phases.push({ ...suggestedPhase, id: `phase-${Date.now()}` })
    return { ...current, phases, matches: [] }
  })
  const updateMatch = (id: string, patch: Partial<Match>) => setState((current) => ({
    ...current, matches: current.matches.map((match) => match.id === id ? { ...match, ...patch } : match),
  }))
  const resetDemo = () => {
    const nextTeams = parseTeams(demoTeamNames.join('\n'))
    setTeamText(demoTeamNames.join('\n'))
    setState({ config: defaultConfig, teams: nextTeams, selectedFormat: 'groups', phases: getSuggestions(nextTeams.length, defaultConfig)[0]?.phases ?? [], matches: [] })
    setView('design')
  }

  const header = <header className="topbar">
    <div><div className="eyebrow">Torneo</div><h1>{config.name}</h1></div>
    <div className="topbar-actions">
      <div className="theme-switch" aria-label="Tema dell’interfaccia">
        <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')} aria-label="Tema chiaro" title="Chiaro"><Sun size={15} /></button>
        <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')} aria-label="Tema scuro" title="Scuro"><Moon size={15} /></button>
        <button className={theme === 'system' ? 'active' : ''} onClick={() => setTheme('system')} aria-label="Tema del dispositivo" title="Dispositivo"><Monitor size={15} /></button>
      </div>
      <div className="top-status"><span className="live-dot" /> Salvato sul dispositivo</div>
    </div>
  </header>

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Trophy size={21} /></span><span>Toruna<strong>Manager</strong></span></div>
      <nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={19} /><span>{label}</span>{id === 'control' && matches.length > 0 && <b>{matches.length - completed}</b>}</button>)}</nav>
      <div className="sidebar-card">
        <span>Progresso torneo</span>
        <strong>{matches.length ? Math.round((completed / matches.length) * 100) : 0}%</strong>
        <div className="progress"><i style={{ width: `${matches.length ? (completed / matches.length) * 100 : 0}%` }} /></div>
        <small>{completed} di {matches.length} partite concluse</small>
      </div>
      {import.meta.env.DEV && <button className="reset-button" onClick={resetDemo}><RotateCcw size={16} /> Ripristina demo 24 squadre</button>}
    </aside>

    <main>{header}
      {view === 'design' && <div className="page design-page">
        <section className="hero">
          <div><span className="pill">Configurazione</span><h2>Configura il torneo</h2><p>Imposta squadre, orari, campi e numero di partite.</p></div>
          <div className="hero-stats"><Metric value={teams.length} label="squadre" /><Metric value={config.courts} label="campi" /><Metric value={phases.length || '—'} label="fasi" /></div>
        </section>

        <div className="two-columns">
          <section className="panel setup-panel">
            <div className="section-title"><span>01</span><div><h3>Impostazioni torneo</h3><p>Tempi, spazi e carico di gioco</p></div></div>
            <div className="form-grid">
              <label className="field wide"><span>Nome torneo</span><input value={config.name} onChange={(event) => updateConfig('name', event.target.value)} /></label>
              <label className="field"><span>Data</span><input type="date" value={config.date} onChange={(event) => updateConfig('date', event.target.value)} /></label>
              <label className="field"><span>Tipo torneo</span><select value={config.tournamentType} onChange={(event) => updateConfig('tournamentType', event.target.value as TournamentType)}><option value="s3">S3</option><option value="6v6">6 contro 6</option></select></label>
              <label className="field"><span>Campi</span><input type="number" min="1" value={config.courts} onChange={(event) => updateConfig('courts', Math.max(1, Number(event.target.value)))} /></label>
              <label className="field"><span>Inizio</span><input type="time" value={config.startTime} onChange={(event) => updateConfig('startTime', event.target.value)} /></label>
              <label className="field"><span>Fine</span><input type="time" value={config.endTime} onChange={(event) => updateConfig('endTime', event.target.value)} /></label>
            </div>
            <div className="subsection"><div><h4>Formato delle partite</h4><p>La durata viene stimata automaticamente da set e punteggio</p></div></div>
            <div className="number-grid">
              <NumberField label="Set per partita" value={config.setsPerMatch} onChange={(value) => updateConfig('setsPerMatch', Math.max(1, value))} min={1} />
              <NumberField label="Punti per set" value={config.pointsPerSet} onChange={(value) => updateConfig('pointsPerSet', Math.max(1, value))} min={1} />
              <NumberField label="Pausa tra le fasi" value={config.phaseBreakMinutes} onChange={(value) => updateConfig('phaseBreakMinutes', Math.max(0, value))} suffix="min" />
            </div>
            <div className="match-duration-estimate"><Clock3 size={16} /><span>Durata stimata per partita · {config.tournamentType === 's3' ? 'S3' : '6 contro 6'}</span><strong>~{estimateMatchMinutes(config)} min</strong><small>{config.setsPerMatch} set a {config.pointsPerSet} punti · {config.tournamentType === 's3' ? 'scambi brevi (0,65 min per punto)' : 'ritmo 6 contro 6 (1 min per punto)'} · 3 min tra i set</small></div>
          </section>

          <section className="panel teams-panel">
            <div className="section-title"><span>02</span><div><h3>Squadre partecipanti</h3><p>Una per riga, oppure incolla da Excel</p></div><b>{teams.length}</b></div>
            <textarea value={teamText} onChange={(event) => setTeamText(event.target.value)} aria-label="Elenco squadre" />
            <div className="paste-footer"><span><ClipboardList size={16} /> Duplicati e righe vuote saranno rimossi</span><button className="button dark" onClick={importTeamText}><Users size={17} /> Importa elenco</button></div>
          </section>
        </div>

        <section className="suggestions-section">
          <section className="custom-formula panel">
            <div className="custom-formula-heading">
              <div><span className="eyebrow">03 · Formula</span><h2>Costruisci le fasi del torneo</h2><p>Aggiungi o rimuovi fasi e scegli formato, gironi e qualificazione per ciascuna.</p></div>
              <button className="button secondary" onClick={addPhase}><Plus size={17} /> Aggiungi fase</button>
            </div>
            {teams.length > 1 && <div className={`efficiency-status ${overTime ? 'warning' : 'ok'}`}>
              <div><strong>{customMatchCount}</strong><span>partite previste</span></div><div><strong>{formatMinute(estimatedEndMinute)}</strong><span>fine stimata</span></div><div><strong>{config.endTime}</strong><span>ora limite</span></div><p>{overTime ? `Il calendario termina ${Math.floor(overtimeMinutes / 60) ? `${Math.floor(overtimeMinutes / 60)} h ` : ''}${overtimeMinutes % 60} min oltre l’orario. Le impostazioni evidenziate possono ridurre la durata.` : 'Il calendario termina entro l’orario previsto.'}</p>
            </div>}
            <div className="phase-editor-list">
              {phases.map((phase, index) => {
                const entrants = phaseEntrants[index]
                const isLast = index === phases.length - 1
                return <article className="phase-editor" key={phase.id}>
                  <header><span>{index + 1}</span><label className="phase-name"><small>Nome fase</small><input value={phase.name} onChange={(event) => updatePhase(phase.id, { name: event.target.value })} /></label><div className="phase-team-count"><strong>{entrants}</strong><small>squadre in ingresso</small></div><button className="icon-button danger" onClick={() => removePhase(phase.id)} aria-label={`Rimuovi ${phase.name}`}><Trash2 size={17} /></button></header>
                  <div className="phase-fields">
                    <label className="field"><span>Formato</span><select value={phase.format} onChange={(event) => updatePhase(phase.id, { format: event.target.value as FormatKind, groupCount: event.target.value === 'knockout' ? 1 : phase.groupCount, advanceAll: event.target.value === 'groups', advancingTeams: event.target.value === 'knockout' ? 1 : entrants })}><option value="groups">Gironi all’italiana</option><option value="knockout">Eliminazione diretta</option></select></label>
                    {phase.format === 'groups' ? <>
                      {index > 0 && <label className="field"><span>Composizione gironi</span><select value={phase.groupComposition} onChange={(event) => updatePhase(phase.id, { groupComposition: event.target.value as GroupComposition })}><option value="strength">Per livello · forti insieme</option><option value="cross">Incrociati · forti con deboli</option></select></label>}
                      <div className={suggestedGroups.has(phase.id) ? 'efficiency-field' : ''}>
                        <NumberField label="Numero di gironi" value={phase.groupCount} onChange={(value) => updatePhase(phase.id, { groupCount: Math.max(1, Math.min(Math.max(1, Math.floor(entrants / 2)), value)) })} min={1} />
                        {suggestedGroups.has(phase.id) && <button className="field-suggestion" type="button" onClick={() => updatePhase(phase.id, { groupCount: suggestedGroups.get(phase.id) as number })}>Usa {suggestedGroups.get(phase.id)} gironi</button>}
                      </div>
                      {!isLast && <label className="check-field advance-all"><input type="checkbox" checked={phase.advanceAll} onChange={(event) => updatePhase(phase.id, { advanceAll: event.target.checked, advancingTeams: event.target.checked ? entrants : Math.min(entrants, Math.max(phase.groupCount, phase.advancingTeams)) })} /> Passano tutte</label>}
                      {!isLast && !phase.advanceAll && <NumberField label="Squadre alla fase successiva" value={phase.advancingTeams} onChange={(value) => updatePhase(phase.id, { advancingTeams: Math.max(1, Math.min(entrants, value)) })} min={1} />}
                      <div className="phase-summary">{Math.floor(entrants / Math.max(1, phase.groupCount))}–{Math.ceil(entrants / Math.max(1, phase.groupCount))} squadre per girone{isLast ? ' · classifica finale' : phase.advanceAll ? ' · passano tutte' : ` · ${phase.advancingTeams} passano`}</div>
                    </> : <>
                      <label className="check-field"><input type="checkbox" checked={phase.thirdPlaceFinal} onChange={(event) => updatePhase(phase.id, { thirdPlaceFinal: event.target.checked })} /> Finale 3° posto</label>
                      <div className="phase-summary">Tabellone da {entrants} squadre · chi vince avanza</div>
                    </>}
                  </div>
                  {phase.format === 'knockout' && !isLast && <p className="phase-error">L’eliminazione diretta deve essere l’ultima fase.</p>}
                  {phase.format === 'groups' && !isLast && !phase.advanceAll && phase.advancingTeams % phase.groupCount !== 0 && <p className="phase-error">Le qualificate devono essere divisibili per il numero di gironi.</p>}
                </article>
              })}
              {phases.length === 0 && <div className="empty-phases"><GitBranch size={27} /><p>Nessuna fase. Aggiungine una per costruire la formula.</p></div>}
            </div>
            {phaseAdditionSuggestions.length > 0 && <section className="phase-suggestions">
              <header><span className="eyebrow">Possibili fasi successive</span><p>Entrano nei tempi senza cambiare i vincoli del torneo.</p></header>
              <div>{phaseAdditionSuggestions.map((suggestion) => <article key={suggestion.phase.id}><div><strong>{suggestion.label}</strong><p>{suggestion.description} Fine stimata: {formatMinute(suggestion.estimatedEnd)}.</p></div><button className="button secondary" type="button" onClick={() => applyPhaseSuggestion(suggestion.phase)}><Plus size={15} /> Aggiungi</button></article>)}</div>
            </section>}
            <footer className="custom-formula-footer"><p>{customFormulaValid ? 'Formula valida: il calendario può essere generato.' : 'Completa o correggi le fasi prima di generare il calendario.'}</p><button className="button primary" disabled={teams.length < 2 || !customFormulaValid} onClick={createCustomTournament}><Play size={16} /> Genera formula personalizzata</button></footer>
          </section>
        </section>
      </div>}

      {view === 'structure' && <StructureView config={config} teams={teams} matches={matches} selectedFormat={selectedFormat} phases={phases} onConfigure={() => setView('design')} onStart={() => setView('control')} />}

      {view === 'schedule' && <div className="page">
        <div className="page-heading"><div><span className="eyebrow">Calendario</span><h2>Partite per campo</h2><p>Orari, campi e turni di riposo.</p></div><div className="heading-metrics"><Metric value={matches.length} label="incontri" /><Metric value={matches.length ? formatMinute(Math.max(...matches.map((m) => m.endMinute))) : '—'} label="fine prevista" /></div></div>
        {matches.length === 0 ? <EmptyState icon={CalendarDays} title="Il calendario non è ancora stato generato" action={() => setView('design')} /> : <div className="court-board">
          {Array.from({ length: config.courts }, (_, index) => index + 1).map((court) => <section className="court-column" key={court}>
            <header><div><MapPin size={17} /> Campo {court}</div><span>{matches.filter((m) => m.court === court).length} gare</span></header>
            <div className="court-matches">{matches.filter((m) => m.court === court).sort((a, b) => a.startMinute - b.startMinute).map((match) => <MatchCard key={match.id} match={match} matches={matches} teamById={teamById} onEdit={() => setEditingMatch(match)} />)}</div>
          </section>)}
        </div>}
      </div>}

      {view === 'control' && <div className="page control-page">
        <div className="page-heading"><div><span className="eyebrow live"><i /> Regia torneo</span><h2>Gestione incontri</h2><p>Stato dei campi e risultati.</p></div><div className="heading-metrics"><Metric value={`${completed}/${matches.length}`} label="concluse" /><Metric value={matches.filter((m) => m.status === 'playing').length} label="in campo" /></div></div>
        {matches.length === 0 ? <EmptyState icon={Play} title="Crea prima il torneo e il suo calendario" action={() => setView('design')} /> : <>
          {nextMatch && <section className="next-callout">
            <div className="callout-icon"><Play fill="currentColor" /></div>
            <div><span>Prossima partita · {formatMinute(nextMatch.startMinute)}</span><h3>{participantLabel(nextMatch.teamAId, matches, teamById)} <small>vs</small> {participantLabel(nextMatch.teamBId, matches, teamById)}</h3><p>{nextMatch.phaseName} · Turno {nextMatch.round} · Campo {nextMatch.court}</p></div>
            <button className="button light" onClick={() => updateMatch(nextMatch.id, { status: 'playing' })}><Play size={16} /> Avvia partita</button>
          </section>}
          <div className="live-courts">{Array.from({ length: config.courts }, (_, index) => index + 1).map((court) => {
            const active = matches.find((match) => match.court === court && match.status === 'playing')
            return <section className={`live-court ${active ? 'busy' : ''}`} key={court}>
              <header><span><MapPin size={17} /> Campo {court}</span><b>{active ? 'In gioco' : 'Libero'}</b></header>
              {active ? <>
                <div className="live-matchup"><ParticipantBadge source={active.teamAId} matches={matches} teamById={teamById} /><strong>VS</strong><ParticipantBadge source={active.teamBId} matches={matches} teamById={teamById} /></div>
                <div className="court-actions">
                  <button className="button primary" onClick={() => setEditingMatch(active)}><Save size={16} /> Risultato</button>
                </div>
              </> : <div className="free-court"><Check size={24} /><p>Pronto per la prossima partita</p></div>}
            </section>
          })}</div>
          <section className="panel queue-panel"><div className="section-title"><span><Clock3 size={18} /></span><div><h3>Coda incontri</h3><p>Le prossime partite pianificate</p></div></div>
            <div className="queue-list">{matches.filter((match) => match.status === 'scheduled' && resolveParticipantId(match.teamAId, matches) && resolveParticipantId(match.teamBId, matches)).slice(0, 8).map((match) => <div key={match.id}><time>{formatMinute(match.startMinute)}</time><ParticipantBadge source={match.teamAId} matches={matches} teamById={teamById} /><span>vs</span><ParticipantBadge source={match.teamBId} matches={matches} teamById={teamById} /><b>Campo {match.court}</b><button className="icon-button" aria-label="Avvia partita" onClick={() => updateMatch(match.id, { status: 'playing' })}><Play size={18} /></button></div>)}</div>
          </section>
        </>}
      </div>}

      {view === 'standings' && <StandingsView matches={matches} teams={teams} format={selectedFormat} poolFilter={poolFilter} setPoolFilter={setPoolFilter} onEdit={setEditingMatch} />}
    </main>
    {editingMatch && <ResultEditor match={editingMatch} matches={matches} teams={teams} config={config} onClose={() => setEditingMatch(null)} onSave={(sets) => { updateMatch(editingMatch.id, { sets, status: 'completed' }); setEditingMatch(null) }} />}
  </div>
}

function MatchCard({ match, matches, teamById, onEdit }: { match: Match; matches: Match[]; teamById: Map<string, Team>; onEdit: () => void }) {
  const result = getSetWinner(match.sets)
  const ready = Boolean(resolveParticipantId(match.teamAId, matches) && resolveParticipantId(match.teamBId, matches))
  return <button className={`match-card ${match.status}`} disabled={!ready} onClick={onEdit}>
    <div className="match-time"><time>{formatMinute(match.startMinute)}</time><span>{match.pool ? `Girone ${match.pool}` : `Turno ${match.round}`}</span></div>
    <div className="match-team"><ParticipantBadge source={match.teamAId} matches={matches} teamById={teamById} />{match.status === 'completed' && <b>{result.a}</b>}</div>
    <div className="match-team"><ParticipantBadge source={match.teamBId} matches={matches} teamById={teamById} />{match.status === 'completed' && <b>{result.b}</b>}</div>
    <footer>{match.status === 'completed' ? <><Check size={14} /> Conclusa</> : 'Inserisci risultato'}</footer>
  </button>
}

type StructureMatch = { code: string; sideA: string; sideB: string; note?: string }

function buildFinalRounds(seedLabels: string[], thirdPlace: boolean) {
  const teamCount = seedLabels.length
  if (![2, 4, 8, 16].includes(teamCount)) return []
  const names: Record<number, string> = { 16: 'Ottavi di finale', 8: 'Quarti di finale', 4: 'Semifinali', 2: 'Finale' }
  const rounds: Array<{ name: string; matches: StructureMatch[] }> = []
  let codeIndex = 0
  let previousCodes: string[] = []
  let matchesInRound = teamCount / 2

  while (matchesInRound >= 1) {
    const current: StructureMatch[] = []
    for (let index = 0; index < matchesInRound; index += 1) {
      const code = String.fromCharCode(65 + codeIndex++)
      if (previousCodes.length === 0) {
        current.push({ code, sideA: seedLabels[index], sideB: seedLabels[teamCount - index - 1] })
      } else {
        current.push({ code, sideA: `Vincente ${previousCodes[index * 2]}`, sideB: `Vincente ${previousCodes[index * 2 + 1]}` })
      }
    }
    rounds.push({ name: names[matchesInRound * 2], matches: current })
    previousCodes = current.map((match) => match.code)
    matchesInRound /= 2
  }

  if (thirdPlace && rounds.length > 1) {
    const semifinalCodes = rounds.at(-2)?.matches.map((match) => match.code) ?? []
    if (semifinalCodes.length === 2) {
      rounds.at(-1)?.matches.push({
        code: String.fromCharCode(65 + codeIndex),
        sideA: `Perdente ${semifinalCodes[0]}`,
        sideB: `Perdente ${semifinalCodes[1]}`,
        note: '3° posto',
      })
    }
  }
  return rounds
}

function StructureView({ config, teams, matches, selectedFormat, phases, onConfigure, onStart }: { config: TournamentConfig; teams: Team[]; matches: Match[]; selectedFormat: FormatKind; phases: TournamentPhase[]; onConfigure: () => void; onStart: () => void }) {
  const previewMatches = useMemo(
    () => matches.length > 0 ? matches : teams.length > 1 ? generateMatches(teams, config, phases[0]?.format ?? selectedFormat, phases) : [],
    [matches, teams, config, selectedFormat, phases],
  )
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams])
  const poolNames = [...new Set(previewMatches.map((match) => match.pool).filter(Boolean))].sort() as string[]
  const pools = poolNames.map((name) => {
    const poolMatches = previewMatches.filter((match) => match.pool === name)
    const ids = [...new Set(poolMatches.flatMap((match) => [match.teamAId, match.teamBId]))]
    return { name, matches: poolMatches, teams: ids.map((id) => teamById.get(id) ?? id) }
  })
  const groupPhase = phases.find((phase) => phase.format === 'groups')
  const knockoutPhase = phases.find((phase) => phase.format === 'knockout')
  const configuredFinalTeams = knockoutPhase && groupPhase ? (groupPhase.advanceAll ? teams.length : groupPhase.advancingTeams) : 0
  const configuredThirdPlace = knockoutPhase?.thirdPlaceFinal ?? config.thirdPlaceFinal
  const effectiveFormat = phases[0]?.format ?? selectedFormat
  const finalsInvalid = configuredFinalTeams > teams.length || (effectiveFormat === 'groups' && configuredFinalTeams > 0 && pools.length > 0 && !groupPhase?.advanceAll && configuredFinalTeams % pools.length !== 0)
  const validFinalCount = finalsInvalid ? 0 : configuredFinalTeams
  const qualifiersPerPool = pools.length > 0 ? Math.floor(validFinalCount / pools.length) : 0
  const extraQualifiers = pools.length > 0 ? validFinalCount % pools.length : 0
  const qualifierSources = pools.length > 0
    ? [
        ...Array.from({ length: qualifiersPerPool }, (_, rank) => pools.map((pool) => `${rank + 1}ª Girone ${pool.name}`)).flat(),
        ...Array.from({ length: extraQualifiers }, (_, index) => `${index + 1}ª migliore ${qualifiersPerPool + 1}ª`),
      ]
    : []
  const finalRounds = buildFinalRounds(qualifierSources, configuredThirdPlace)
  const poolSizes = [...new Set(pools.map((pool) => pool.teams.length))].sort((a, b) => a - b)
  const phaseDescription = `${pools.length} giron${pools.length === 1 ? 'e' : 'i'} da ${poolSizes.join('–')} squadre`
  const qualificationRule = groupPhase?.advanceAll && knockoutPhase
    ? 'Passano tutte le squadre'
    : validFinalCount === 0
    ? 'Nessuna fase finale'
    : pools.length > 0
      ? `${qualifiersPerPool > 0 ? `Prime ${qualifiersPerPool} di ogni girone` : ''}${qualifiersPerPool > 0 && extraQualifiers > 0 ? ' + ' : ''}${extraQualifiers > 0 ? `${extraQualifiers} migliori ${qualifiersPerPool + 1}ª` : ''}`
      : 'Nessuna fase finale'

  if (teams.length < 2) return <div className="page"><EmptyState icon={GitBranch} title="Inserisci almeno due squadre" action={onConfigure} /></div>

  const customMultiStage = phases.length > 2 || phases.filter((phase) => phase.format === 'groups').length > 1
  if (customMultiStage) {
    const sourceLabel = (source: string) => {
      const resolved = resolveParticipantId(source, previewMatches)
      if (resolved && teamById.has(resolved)) return teamById.get(resolved) as string
      if (teamById.has(source)) return teamById.get(source) as string
      const rank = source.match(/^rank:pool-([^:]+):(\d+)$/)
      if (rank) return `${rank[2]}ª classificata · Girone ${rank[1]}`
      const reference = source.match(/^(winner|loser):match-(\d+)$/)
      if (reference) return `${reference[1] === 'winner' ? 'Vincente' : 'Perdente'} partita ${reference[2]}`
      return 'Da definire'
    }
    return <div className="page structure-page">
      <div className="page-heading"><div><span className="eyebrow">Struttura personalizzata</span><h2>{phases.length} fasi del torneo</h2><p>Il percorso completo definito nella formula personalizzata.</p></div><div className="heading-actions"><button className="button secondary" onClick={onConfigure}><Settings2 size={17} /> Modifica struttura</button><button className="button primary" disabled={!matches.length} onClick={onStart}><Play size={17} /> Avvia torneo</button></div></div>
      {phases.map((phase, phaseIndex) => {
        const phaseMatches = previewMatches.filter((match) => match.phaseId === phase.id)
        const roundNumbers = [...new Set(phaseMatches.map((match) => match.round))].sort((a, b) => a - b)
        const phasePoolNames = [...new Set(phaseMatches.map((match) => match.pool).filter(Boolean))].sort() as string[]
        const phasePools = phasePoolNames.map((name) => ({
          name,
          teams: [...new Set(phaseMatches.filter((match) => match.pool === name).flatMap((match) => [match.teamAId, match.teamBId]))],
        }))
        const qualifiersPerPool = phase.advanceAll ? null : Math.floor(phase.advancingTeams / Math.max(1, phase.groupCount))
        return <section className={`phase-block ${phase.format === 'knockout' ? 'finals-phase' : ''}`} key={phase.id}>
          <header className="phase-heading"><div><span>Fase {phaseIndex + 1}</span><h3>{phase.name}</h3></div><p>{phase.format === 'groups' ? `${phase.groupCount} gironi${phaseIndex > 0 ? phase.groupComposition === 'cross' ? ' incrociati' : ' per livello' : ''}${phaseIndex < phases.length - 1 ? phase.advanceAll ? ' · passano tutte' : ` · ${phase.advancingTeams} qualificate` : ''}` : 'Eliminazione diretta'}</p></header>
          {phase.format === 'groups' ? <div className="pools-grid">{phasePools.map((pool) => <article className="pool-card" key={pool.name}>
            <header><h4>Girone {pool.name.replace(/^\d+/, '')}</h4><span>{pool.teams.length} squadre</span></header>
            <ol>{pool.teams.map((source) => <li key={source}>{sourceLabel(source)}</li>)}</ol>
            {phaseIndex < phases.length - 1 && <footer>{phase.advanceAll ? 'Passano tutte' : `Passano le prime ${qualifiersPerPool}`}</footer>}
          </article>)}</div> : <div className="structure-board final-board">{roundNumbers.map((round) => <section className="structure-round" key={round}><h4>{phaseMatches.filter((match) => match.round === round)[0]?.phaseName ?? `Turno ${round}`}</h4><div className="structure-matches">{phaseMatches.filter((match) => match.round === round).map((match) => <article className="structure-match final-match" key={match.id}><span>Partita {match.id.replace('match-', '')}</span><div>{sourceLabel(match.teamAId)}</div><div>{sourceLabel(match.teamBId)}</div></article>)}</div></section>)}</div>}
        </section>
      })}
    </div>
  }

  if (effectiveFormat === 'knockout') {
    const codeById = new Map(previewMatches.map((match, index) => [match.id, String.fromCharCode(65 + index)]))
    const knockoutRounds = [...new Set(previewMatches.map((match) => match.round))].sort((a, b) => a - b)
    const sourceLabel = (source: string) => {
      const resolved = resolveParticipantId(source, previewMatches)
      if (resolved) return teamById.get(resolved) ?? resolved
      const reference = source.match(/^(winner|loser):(.+)$/)
      if (!reference) return source
      return `${reference[1] === 'winner' ? 'Vincente' : 'Perdente'} ${codeById.get(reference[2]) ?? reference[2]}`
    }
    return <div className="page structure-page">
      <div className="page-heading"><div><span className="eyebrow">Struttura</span><h2>Eliminazione diretta</h2><p>Chi vince avanza al turno successivo. Chi perde viene eliminato.</p></div><div className="heading-actions"><button className="button secondary" onClick={onConfigure}><Settings2 size={17} /> Modifica struttura</button><button className="button primary" disabled={!matches.length} onClick={onStart}><Play size={17} /> Avvia torneo</button></div></div>
      <section className="formula-flow knockout-flow"><article><span>1</span><div><small>Formato</small><h3>{teams.length} squadre · eliminazione diretta</h3><p>{2 ** Math.ceil(Math.log2(teams.length)) === teams.length ? 'Tutte iniziano dallo stesso turno.' : `${2 ** Math.ceil(Math.log2(teams.length)) - teams.length} passaggi diretti nel primo turno.`}</p></div></article><ChevronRight className="flow-arrow" /><article><span>2</span><div><small>Regola</small><h3>Vincente avanti, perdente eliminata</h3><p>Le perdenti delle semifinali giocano la finale per il 3° posto solo se attivata.</p></div></article></section>
      <section className="phase-block finals-phase">
        <header className="phase-heading"><div><span>Tabellone</span><h3>Dagli scontri iniziali alla finale</h3></div><p>Le lettere identificano le partite</p></header>
        <div className="structure-board final-board">{knockoutRounds.map((round) => {
          const roundMatches = previewMatches.filter((match) => match.round === round)
          return <section className="structure-round" key={round}><h4>{roundMatches[0]?.phaseName ?? `Turno ${round}`}</h4><div className="structure-matches">{roundMatches.map((match) => <article className="structure-match final-match" key={match.id}>
            <span>Partita {codeById.get(match.id)}</span><div>{sourceLabel(match.teamAId)}</div><div>{sourceLabel(match.teamBId)}</div>
          </article>)}</div></section>
        })}</div>
      </section>
    </div>
  }

  return <div className="page structure-page">
    <div className="page-heading"><div><span className="eyebrow">Struttura</span><h2>Come funziona il torneo</h2><p>Fasi, qualificazione e provenienza delle squadre.</p></div><div className="heading-actions"><button className="button secondary" onClick={onConfigure}><Settings2 size={17} /> Modifica struttura</button><button className="button primary" disabled={!matches.length} onClick={onStart}><Play size={17} /> Avvia torneo</button></div></div>
    <section className="formula-flow" aria-label="Riepilogo della formula">
      <article><span>1</span><div><small>Prima fase</small><h3>{phaseDescription}</h3><p>Ogni squadra affronta tutte le altre del proprio girone.</p></div></article>
      <ChevronRight className="flow-arrow" />
      <article><span>2</span><div><small>Qualificazione</small><h3>{qualificationRule}</h3><p>{validFinalCount > 0 ? `${teams.length - validFinalCount} squadre vengono eliminate al termine della prima fase.` : 'La classifica della prima fase è quella definitiva.'}</p></div></article>
      {finalRounds.length > 0 && <><ChevronRight className="flow-arrow" /><article><span>3</span><div><small>Fase finale</small><h3>{finalRounds.map((round) => round.name).join(' → ')}</h3><p>Eliminazione diretta{configuredThirdPlace && validFinalCount >= 4 ? ' con finale per il 3° posto' : ''}.</p></div></article></>}
    </section>
    <section className="phase-block">
      <header className="phase-heading"><div><span>Fase 1</span><h3>Composizione dei gironi</h3></div><p>{teams.length} squadre</p></header>
      <div className="pools-grid">{pools.map((pool) => <article className="pool-card" key={pool.name}>
        <header><h4>Girone {pool.name.replace(/^\d+/, '')}</h4><span>{pool.teams.length} squadre</span></header>
        <ol>{pool.teams.map((team) => <li key={team}>{team}</li>)}</ol>
        <footer>{groupPhase?.advanceAll ? 'Passano tutte' : qualifiersPerPool > 0 ? `Passano le prime ${qualifiersPerPool}` : 'Classifica finale del girone'}</footer>
      </article>)}</div>
    </section>
    {finalsInvalid && <div className="structure-warning">La fase finale da {configuredFinalTeams} squadre non è compatibile con {pools.length} gironi: deve qualificarsi lo stesso numero di squadre da ogni girone.</div>}
    {finalRounds.length > 0 && <section className="phase-block finals-phase">
      <header className="phase-heading"><div><span>Fase 2</span><h3>Tabellone a eliminazione diretta</h3></div><p>{validFinalCount} qualificate · le lettere identificano le partite</p></header>
      <div className="structure-board final-board">
        {finalRounds.map((round) => <section className="structure-round" key={round.name}>
          <h4>{round.name}</h4>
          <div className="structure-matches">{round.matches.map((match) => <article className="structure-match final-match" key={match.code}>
            <span>Partita {match.code}{match.note ? ` · ${match.note}` : ''}</span>
            <div>{match.sideA}</div><div>{match.sideB}</div>
          </article>)}</div>
        </section>)}
      </div>
    </section>}
  </div>
}

function StandingsView({ matches, teams, format, poolFilter, setPoolFilter, onEdit }: { matches: Match[]; teams: Team[]; format: FormatKind; poolFilter: string; setPoolFilter: (value: string) => void; onEdit: (match: Match) => void }) {
  const pools = [...new Set(matches.map((match) => match.pool).filter(Boolean))] as string[]
  const visibleMatches = poolFilter === 'all' ? matches : matches.filter((match) => match.pool === poolFilter)
  const ids = new Set(visibleMatches.flatMap((match) => [match.teamAId, match.teamBId]))
  const visibleTeams = matches.length ? teams.filter((team) => ids.has(team.id)) : teams
  const standings = calculateStandings(visibleTeams, visibleMatches)
  const teamById = new Map(teams.map((team) => [team.id, team]))
  if (format === 'knockout') return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Eliminazione diretta</span><h2>Risultati</h2><p>Non c’è una classifica: chi vince avanza nel tabellone.</p></div></div>
    <section className="panel knockout-results">{matches.filter((match) => match.status === 'completed').length === 0 ? <div className="empty-results">Nessuna partita conclusa</div> : matches.filter((match) => match.status === 'completed').map((match) => {
      const result = getSetWinner(match.sets)
      return <button key={match.id} onClick={() => onEdit(match)}><span>{match.phaseName}</span><b>{participantLabel(match.teamAId, matches, teamById)}</b><strong>{result.a} – {result.b}</strong><b>{participantLabel(match.teamBId, matches, teamById)}</b></button>
    })}</section>
  </div>
  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Classifica</span><h2>Risultati e classifica</h2><p>Vittorie, punti gara, quoziente set e quoziente punti.</p></div>{pools.length > 0 && <div className="pool-tabs"><button className={poolFilter === 'all' ? 'active' : ''} onClick={() => setPoolFilter('all')}>Generale</button>{pools.map((pool) => <button className={poolFilter === pool ? 'active' : ''} onClick={() => setPoolFilter(pool)} key={pool}>Girone {pool}</button>)}</div>}</div>
    {matches.length === 0 ? <EmptyState icon={BarChart3} title="Le classifiche appariranno dopo la generazione" /> : <div className="standings-layout">
      <section className="panel standings-panel"><table><thead><tr><th>#</th><th>Squadra</th><th>G</th><th>V</th><th>S</th><th>PT</th><th>Set</th><th>Q. set</th><th>Punti</th><th>Q. punti</th></tr></thead><tbody>{standings.map((row, index) => <tr key={row.teamId}><td><strong className={index < 2 ? 'rank qualified' : 'rank'}>{index + 1}</strong></td><td><TeamBadge team={teamById.get(row.teamId)} /></td><td>{row.played}</td><td>{row.won}</td><td>{row.lost}</td><td><strong>{row.tablePoints}</strong></td><td>{row.setsWon}:{row.setsLost}</td><td>{Number.isFinite(row.setRatio) ? row.setRatio.toFixed(3) : '∞'}</td><td>{row.pointsFor}:{row.pointsAgainst}</td><td>{Number.isFinite(row.pointRatio) ? row.pointRatio.toFixed(3) : '∞'}</td></tr>)}</tbody></table></section>
      <section className="panel recent-results"><div className="section-title"><span><Trophy size={18} /></span><div><h3>Ultimi risultati</h3><p>{visibleMatches.filter((m) => m.status === 'completed').length} referti registrati</p></div></div>{visibleMatches.filter((m) => m.status === 'completed').slice(-6).reverse().map((match) => { const result = getSetWinner(match.sets); return <button key={match.id} onClick={() => onEdit(match)}><span>{participantLabel(match.teamAId, matches, teamById)}</span><strong>{result.a} – {result.b}</strong><span>{participantLabel(match.teamBId, matches, teamById)}</span></button> })}</section>
    </div>}
  </div>
}

function EmptyState({ icon: Icon, title, action }: { icon: typeof CalendarDays; title: string; action?: () => void }) {
  return <div className="empty-state"><Icon size={34} /><h3>{title}</h3><p>Configura squadre e vincoli nella sezione Progetta.</p>{action && <button className="button dark" onClick={action}><Settings2 size={17} /> Vai alla configurazione</button>}</div>
}
