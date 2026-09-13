import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  CalendarDays, Check, ChevronRight, CircleDot, ClipboardList, Clock3,
  Download, GitBranch, LayoutDashboard, MapPin, Monitor, Moon, Play, Plus, RotateCcw, Save, Settings2, Sun, Trash2, Trophy, Upload, Users, X,
} from 'lucide-react'
import { alphabeticalLabel, calculateStandings, canStartOnSharedCourts, dependentMatchIds, estimateMatchMinutes, formatMinute, generateMatches, generateParallelMatches, getKnockoutWinner, getSetWinner, isBalancedKnockout, isValidSetScore, knockoutSizesUpTo, knockoutTeamCountsUpTo, parseTeams, resolveMatchesForStandings, resolveParticipantId, toMinute, tournamentEndMinute } from './engine/core'
import { demoTeamNames, demoTournamentTeamNames } from './engine/demo'
import type { FormatKind, GroupComposition, Match, SetScore, Team, TournamentConfig, TournamentPhase, TournamentState, TournamentType } from './engine/types'

type View = 'design' | 'structure' | 'schedule' | 'control'
type ThemeMode = 'light' | 'dark' | 'system'
type TournamentWorkspace = { id: string; label: string; state: TournamentState }
type MultiTournamentState = { activeId: string; tournaments: TournamentWorkspace[] }
type ManagedMatch = { tournamentId: string; tournamentLabel: string; match: Match; matches: Match[]; teams: Team[]; config: TournamentConfig }

const defaultConfig: TournamentConfig = {
  name: 'Volley Day 2026',
  date: '2026-09-20',
  startTime: '09:00',
  endTime: '20:00',
  courts: 4,
  tournamentType: 's3-green',
  setsPerMatch: 1,
  pointsPerSet: 15,
  setPoints: [15],
  winByTwo: false,
  phaseBreakMinutes: 15,
  groupCount: 4,
  finalTeams: 8,
  thirdPlaceFinal: true,
}

const MULTI_STATE_KEY = 'tournamanager-multi-state-v2'
const THEME_KEY = 'tournamanager-theme'
const MAX_TEAMS = 128
const MAX_COURTS = 16
const MAX_SETS = 9
const MAX_PHASES = 8
const clampInteger = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : min
const balancedGroupCounts = (teamCount: number) => Array.from({ length: Math.max(1, Math.floor(teamCount / 2)) }, (_, index) => index + 1).filter((count) => teamCount % count === 0)
const normalizeTournamentType = (value: unknown): TournamentType => value === 's3-red' || value === 's3-green' || value === 's3-white' || value === '6v6' ? value : 's3-green'
const tournamentTypeLabels: Record<TournamentType, string> = { 's3-red': 'S3 Red', 's3-green': 'S3 Green', 's3-white': 'S3 White', '6v6': '6 contro 6' }
const tournamentPaceLabels: Record<TournamentType, string> = {
  's3-red': 'ritmo S3 Red · più rapido',
  's3-green': 'ritmo S3 Green',
  's3-white': 'ritmo S3 White · più lento',
  '6v6': 'ritmo 6 contro 6 (1 min per punto)',
}
const matchDefaultsByTournamentType: Record<TournamentType, number[]> = {
  's3-red': [15],
  's3-green': [15],
  's3-white': [8],
  '6v6': [21, 21],
}

const normalizeSetPoints = (config: Partial<TournamentConfig>) => Array.from(
  { length: clampInteger(config.setsPerMatch ?? 2, 1, MAX_SETS) },
  (_, index) => clampInteger(config.setPoints?.[index] ?? config.pointsPerSet ?? 21, 1, 99),
)

const normalizeConfig = (config: TournamentConfig): TournamentConfig => ({
  ...defaultConfig,
  ...config,
  tournamentType: normalizeTournamentType(config.tournamentType),
  courts: clampInteger(config.courts ?? defaultConfig.courts, 1, MAX_COURTS),
  setsPerMatch: clampInteger(config.setsPerMatch ?? defaultConfig.setsPerMatch, 1, MAX_SETS),
  winByTwo: false,
  phaseBreakMinutes: clampInteger(config.phaseBreakMinutes ?? defaultConfig.phaseBreakMinutes, 0, 240),
  setPoints: normalizeSetPoints(config),
})

const makeDefaultPhases = (teamCount: number): TournamentPhase[] => {
  if (teamCount < 2) return []
  const divisors = Array.from({ length: Math.max(1, Math.floor(teamCount / 2)) }, (_, index) => index + 1).filter((count) => teamCount % count === 0)
  const groupCount = divisors.sort((a, b) => Math.abs(teamCount / a - 4) - Math.abs(teamCount / b - 4))[0] ?? 1
  return [{ id: 'phase-1', name: 'Fase a gironi', format: 'groups', groupCount, groupComposition: 'strength', advanceAll: true, advancingTeams: teamCount, thirdPlaceFinal: false }]
}

const enforceFinalGroupComposition = (phases: TournamentPhase[]) => phases.map((phase, index) => index === phases.length - 1 && index > 0 && phase.format === 'groups' ? { ...phase, groupComposition: 'strength' as const } : phase)

const makeInitialState = (): TournamentState => {
  const teams = import.meta.env.DEV ? parseTeams(demoTeamNames.join('\n')) : []
  return {
    config: defaultConfig,
    teams,
    selectedFormat: 'groups',
    phases: makeDefaultPhases(teams.length),
    matches: [],
  }
}

const makeInitialWorkspaces = (): MultiTournamentState => {
  const saved = localStorage.getItem(MULTI_STATE_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as MultiTournamentState
      if (parsed.tournaments?.length) {
        const template = parsed.tournaments[0].state
        const shared = template.config
        const tournaments = parsed.tournaments.map((tournament, tournamentIndex) => ({
          ...tournament,
          label: tournament.label ?? `Torneo ${tournamentIndex + 1}`,
          state: {
            ...tournament.state,
            config: normalizeConfig({ ...tournament.state.config, name: shared.name, date: shared.date, startTime: shared.startTime, endTime: shared.endTime, courts: shared.courts, phaseBreakMinutes: shared.phaseBreakMinutes }),
            phases: enforceFinalGroupComposition(Array.from({ length: Math.min(MAX_PHASES, template.phases.length) }, (_, phaseIndex) => {
              const phase = tournament.state.phases[phaseIndex] ?? { ...template.phases[phaseIndex], id: `phase-${phaseIndex + 1}-${tournamentIndex}` }
              return {
                ...phase,
                groupComposition: phase.groupComposition ?? 'strength',
                advanceAll: phase.advanceAll ?? phaseIndex === 0,
                advancingTeams: phase.advancingTeams ?? tournament.state.teams.length,
              }
            })),
          },
        }))
        const activeId = tournaments.some((tournament) => tournament.id === parsed.activeId) ? parsed.activeId : tournaments[0].id
        const canRefreshSchedule = tournaments.some((tournament) => tournament.state.matches.length) && tournaments.every((tournament) =>
          tournament.state.matches.every((match) => match.status === 'scheduled') &&
          tournament.state.phases.length === tournaments[0].state.phases.length &&
          isFormulaValid(tournament.state.teams.length, tournament.state.phases),
        )
        if (!canRefreshSchedule) return { ...parsed, activeId, tournaments }
        const schedules = generateParallelMatches(tournaments.map((tournament) => ({ id: tournament.id, teams: tournament.state.teams, config: tournament.state.config, phases: tournament.state.phases })))
        return { ...parsed, activeId, tournaments: tournaments.map((tournament) => ({ ...tournament, state: { ...tournament.state, matches: schedules[tournament.id] ?? [] } })) }
      }
    } catch { /* use defaults */ }
  }
  const initial = makeInitialState()
  return { activeId: 'tournament-1', tournaments: [{ id: 'tournament-1', label: 'Torneo 1', state: initial }] }
}

const makeBlankTournament = (sharedConfig: TournamentConfig, phases: TournamentPhase[], tournamentIndex: number): TournamentState => {
  const teams = import.meta.env.DEV ? parseTeams((demoTournamentTeamNames[tournamentIndex] ?? []).join('\n')) : []
  const defaultPhases = makeDefaultPhases(teams.length)
  return {
    config: { ...sharedConfig }, teams, selectedFormat: 'groups',
    phases: enforceFinalGroupComposition(phases.map((phase, index) => {
      const fallback = defaultPhases[index]
      return { ...phase, ...(fallback && phase.format === 'groups' ? { groupCount: fallback.groupCount, advanceAll: true, advancingTeams: teams.length } : {}), id: `phase-${index + 1}-${Date.now()}-${tournamentIndex}` }
    })),
    matches: [],
  }
}

const navItems: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'design', label: 'Progetta', icon: LayoutDashboard },
  { id: 'structure', label: 'Struttura', icon: GitBranch },
  { id: 'schedule', label: 'Calendario', icon: CalendarDays },
  { id: 'control', label: 'Regia e classifiche', icon: CircleDot },
]

function isFormulaValid(teamCount: number, phases: TournamentPhase[]) {
  let entrants = teamCount
  return phases.length > 0 && phases.every((phase, index) => {
    const currentEntrants = entrants
    entrants = phase.format === 'groups' ? (phase.advanceAll ? entrants : phase.advancingTeams || entrants) : 1
    if (phase.format === 'knockout') return index === phases.length - 1 && isBalancedKnockout(currentEntrants, phase.groupCount)
    const groupsValid = currentEntrants >= 2 && phase.groupCount >= 1 && phase.groupCount <= Math.max(1, Math.floor(currentEntrants / 2))
    return index === phases.length - 1 ? groupsValid : groupsValid && (phase.advanceAll || (phase.advancingTeams >= 1 && phase.advancingTeams <= currentEntrants))
  })
}

function appendSuggestedPhase(current: MultiTournamentState, suggestedPhase: TournamentPhase): MultiTournamentState {
  return {
    ...current,
    tournaments: current.tournaments.map((tournament, tournamentIndex) => {
      const previousIndex = tournament.state.phases.length - 1
      let entrants = tournament.state.teams.length
      tournament.state.phases.slice(0, previousIndex).forEach((phase) => {
        entrants = phase.format === 'groups' ? (phase.advanceAll ? entrants : phase.advancingTeams) : 1
      })
      const previous = tournament.state.phases[previousIndex]
      const entrantsForNext = previous?.format === 'groups' ? entrants : 1
      const knockoutSize = knockoutTeamCountsUpTo(entrantsForNext, Math.max(1, suggestedPhase.groupCount)).at(-1) ?? 0
      const advancingToSuggestedPhase = suggestedPhase.format === 'knockout' ? knockoutSize : entrantsForNext
      const nextPhases = tournament.state.phases.map((phase, index) => index === previousIndex && phase.format === 'groups'
        ? { ...phase, advanceAll: advancingToSuggestedPhase === entrantsForNext, advancingTeams: advancingToSuggestedPhase }
        : phase)
      const divisors = Array.from({ length: Math.max(1, Math.floor(entrantsForNext / 2)) }, (_, index) => index + 1).filter((count) => entrantsForNext % count === 0)
      const groupCount = divisors.sort((a, b) => Math.abs(entrantsForNext / a - 4) - Math.abs(entrantsForNext / b - 4))[0] ?? 1
      nextPhases.push({
        ...suggestedPhase,
        id: `${suggestedPhase.id}-${nextPhases.length + 1}-${tournament.id}-${tournamentIndex}`,
        groupCount: suggestedPhase.format === 'groups' ? groupCount : 1,
        advancingTeams: suggestedPhase.format === 'groups' ? entrantsForNext : 1,
      })
      return { ...tournament, state: { ...tournament.state, phases: enforceFinalGroupComposition(nextPhases), matches: [] } }
    }),
  }
}

function DraftIntegerInput({ value, onCommit, min = 0, max, ariaLabel, autoFocus }: { value: number; onCommit: (value: number) => void; min?: number; max?: number; ariaLabel?: string; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(String(value))
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    const parsed = Number(draft)
    const next = clampInteger(Number.isFinite(parsed) && draft.trim() !== '' ? parsed : value, min, max ?? Number.MAX_SAFE_INTEGER)
    setDraft(String(next))
    if (next !== value) {
      onCommit(next)
      window.setTimeout(() => setDraft(String(valueRef.current)), 0)
    }
  }

  return <input
    type="text"
    inputMode="numeric"
    pattern="[0-9]*"
    value={draft}
    aria-label={ariaLabel}
    autoFocus={autoFocus}
    onChange={(event) => {
      const next = event.target.value
      if (next === '' || /^\d+$/.test(next)) setDraft(next)
    }}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
  />
}

function NumberField({ label, value, onChange, suffix, min = 0, max }: { label: string; value: number; onChange: (value: number) => void; suffix?: string; min?: number; max?: number }) {
  return <label className="field compact-field">
    <span>{label}</span>
    <div className="number-wrap">
      <DraftIntegerInput value={value} onCommit={onChange} min={min} max={max} />
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
  const bestReference = source.match(/^best:phase-(\d+):rank-(\d+):(\d+)$/)
  if (bestReference) return `Qualificata tra le migliori ${bestReference[2]}ª · Fase ${bestReference[1]}`
  return 'Da definire'
}

function ParticipantBadge({ source, matches, teamById }: { source: string; matches: Match[]; teamById: Map<string, Team> }) {
  const resolved = resolveParticipantId(source, matches)
  const team = resolved ? teamById.get(resolved) : undefined
  return team ? <TeamBadge team={team} /> : <span className="team-name muted">{participantLabel(source, matches, teamById)}</span>
}

function ResultEditor({ match, matches, teams, config, onSave, onDelete, onClose }: { match: Match; matches: Match[]; teams: Team[]; config: TournamentConfig; onSave: (sets: SetScore[]) => void; onDelete: () => void; onClose: () => void }) {
  const modalRef = useRef<HTMLElement>(null)
  const targets = normalizeSetPoints(config)
  const [sets, setSets] = useState<SetScore[]>(match.sets.length === config.setsPerMatch ? match.sets : targets.map((target, index) => ({ a: target, b: Math.max(0, target - 3 - index) })))
  const teamA = teams.find((team) => team.id === resolveParticipantId(match.teamAId, matches))
  const teamB = teams.find((team) => team.id === resolveParticipantId(match.teamBId, matches))
  const result = getSetWinner(sets)
  const knockoutWinner = getKnockoutWinner(sets)
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !modalRef.current) return
      const focusable = [...modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1) as HTMLElement
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleKey)
    return () => { window.removeEventListener('keydown', handleKey); previousFocus?.focus() }
  }, [onClose])
  const setsValid = sets.length === config.setsPerMatch && sets.every((set, index) => isValidSetScore(set, targets[index], false))
  const resultValid = setsValid && (Boolean(match.pool) || Boolean(knockoutWinner))
  const update = (index: number, side: 'a' | 'b', value: number) => setSets((current) => current.map((set, i) => i === index ? { ...set, [side]: Number.isFinite(value) ? Math.max(0, Math.min(999, value)) : 0 } : set))
  return <div className="scrim" onMouseDown={onClose}>
    <section ref={modalRef} className="result-modal" role="dialog" aria-modal="true" aria-labelledby="result-editor-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-button close" onClick={onClose} aria-label="Chiudi"><X size={20} /></button>
      <div className="eyebrow">Risultato · Campo {match.court}</div>
      <h2 id="result-editor-title">Inserisci il risultato</h2>
      <div className="score-head">
        <TeamBadge team={teamA} /><strong>{result.a} – {result.b}</strong><TeamBadge team={teamB} />
      </div>
      <div className="set-list">
        {sets.map((set, index) => <div className="set-row" key={index}>
          <span>Set {index + 1}</span>
          <DraftIntegerInput autoFocus={index === 0} min={0} max={999} ariaLabel={`Punti ${teamA?.name} set ${index + 1}`} value={set.a} onCommit={(value) => update(index, 'a', value)} />
          <span>–</span>
          <DraftIntegerInput min={0} max={999} ariaLabel={`Punti ${teamB?.name} set ${index + 1}`} value={set.b} onCommit={(value) => update(index, 'b', value)} />
          <small>Set a {targets[index]} punti</small>
        </div>)}
      </div>
      {!setsValid && <p className="result-error">In ogni set vince chi raggiunge il punteggio configurato.</p>}
      {!match.pool && <p className="result-rule">A parità di set passa chi ha più punti complessivi; poi chi ha vinto l’ultimo set.</p>}
      {!match.pool && setsValid && knockoutWinner && <p className="result-rule"><strong>Passa {knockoutWinner === 'a' ? teamA?.name : teamB?.name}.</strong></p>}
      <div className="modal-actions">
        {match.status === 'completed' && <button className="button danger" onClick={onDelete}><Trash2 size={16} /> Elimina risultato</button>}
        <button className="button secondary" onClick={onClose}>Annulla</button>
        <button className="button primary" disabled={!resultValid} onClick={() => onSave(sets)}><Check size={18} /> Salva risultato</button>
      </div>
    </section>
  </div>
}

type ConfigurationFile = {
  app: 'tournamanager'
  version: 1
  tournaments: Array<{ label: string; state: Omit<TournamentState, 'matches'> }>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function readConfigurationFile(contents: string): MultiTournamentState {
  const file: unknown = JSON.parse(contents)
  if (!isRecord(file) || file.app !== 'tournamanager' || file.version !== 1 || !Array.isArray(file.tournaments) || file.tournaments.length === 0) {
    throw new Error('File non valido')
  }

  const tournaments = file.tournaments.map((entry, tournamentIndex): TournamentWorkspace => {
    if (!isRecord(entry) || !isRecord(entry.state) || !isRecord(entry.state.config) || !Array.isArray(entry.state.teams) || !Array.isArray(entry.state.phases)) {
      throw new Error('File non valido')
    }
    const config = normalizeConfig({ ...defaultConfig, ...entry.state.config } as TournamentConfig)
    const teams = entry.state.teams.slice(0, MAX_TEAMS).map((team, teamIndex): Team => {
      if (!isRecord(team) || typeof team.name !== 'string' || !team.name.trim()) throw new Error('File non valido')
      return { id: `team-${teamIndex + 1}`, name: team.name.trim(), seed: teamIndex + 1, club: typeof team.club === 'string' ? team.club : '' }
    })
    const phases = entry.state.phases.slice(0, MAX_PHASES).map((phase, phaseIndex): TournamentPhase => {
      if (!isRecord(phase) || (phase.format !== 'groups' && phase.format !== 'knockout')) throw new Error('File non valido')
      return {
        id: `phase-${phaseIndex + 1}-${tournamentIndex + 1}`,
        name: typeof phase.name === 'string' && phase.name.trim() ? phase.name.trim() : `Fase ${phaseIndex + 1}`,
        format: phase.format,
        groupCount: clampInteger(Number(phase.groupCount), 1, MAX_TEAMS),
        groupComposition: phase.groupComposition === 'cross' ? 'cross' : 'strength',
        advanceAll: Boolean(phase.advanceAll),
        advancingTeams: clampInteger(Number(phase.advancingTeams), 1, MAX_TEAMS),
        thirdPlaceFinal: Boolean(phase.thirdPlaceFinal),
      }
    })
    const id = `tournament-imported-${tournamentIndex + 1}`
    return {
      id,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : `Torneo ${tournamentIndex + 1}`,
      state: { config, teams, phases: enforceFinalGroupComposition(phases), selectedFormat: phases[0]?.format ?? 'groups', matches: [] },
    }
  })

  const shared = tournaments[0].state.config
  const sharedKeys: Array<keyof TournamentConfig> = ['name', 'date', 'startTime', 'endTime', 'courts', 'phaseBreakMinutes']
  return {
    activeId: tournaments[0].id,
    tournaments: tournaments.map((tournament) => ({
      ...tournament,
      state: { ...tournament.state, config: { ...tournament.state.config, ...Object.fromEntries(sharedKeys.map((key) => [key, shared[key]])) } },
    })),
  }
}

export default function App() {
  const [managerState, setManagerState] = useState<MultiTournamentState>(makeInitialWorkspaces)
  const activeWorkspace = managerState.tournaments.find((tournament) => tournament.id === managerState.activeId) ?? managerState.tournaments[0]
  const activeTournamentIndex = managerState.tournaments.findIndex((tournament) => tournament.id === activeWorkspace.id)
  const state = activeWorkspace.state
  const setState = (update: TournamentState | ((current: TournamentState) => TournamentState)) => setManagerState((current) => ({
    ...current,
    tournaments: current.tournaments.map((tournament) => tournament.id === current.activeId
      ? { ...tournament, state: typeof update === 'function' ? update(tournament.state) : update }
      : tournament),
  }))
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
  })
  const [view, setView] = useState<View>('design')
  const [teamTexts, setTeamTexts] = useState<Record<string, string>>({})
  const [teamErrors, setTeamErrors] = useState<Record<string, string>>({})
  const [editingMatch, setEditingMatch] = useState<{ tournamentId: string; match: Match } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const { config, teams, matches, selectedFormat, phases } = state
  const teamText = teamTexts[activeWorkspace.id] ?? teams.map((team) => team.name).join('\n')
  const setTeamText = (value: string) => setTeamTexts((current) => ({ ...current, [activeWorkspace.id]: value }))
  const otherTournamentMatches = useMemo(() => managerState.tournaments
    .filter((tournament) => tournament.id !== activeWorkspace.id && tournament.state.config.date === config.date)
    .flatMap((tournament) => {
      const tournamentIndex = managerState.tournaments.findIndex((item) => item.id === tournament.id)
      const otherTeamById = new Map(tournament.state.teams.map((team) => [team.id, team]))
      return tournament.state.matches.map((match) => ({
        match,
        tournamentId: tournament.id,
        tournamentName: tournament.label ?? `Torneo ${tournamentIndex + 1}`,
        teamA: participantLabel(match.teamAId, tournament.state.matches, otherTeamById),
        teamB: participantLabel(match.teamBId, tournament.state.matches, otherTeamById),
      }))
    }), [managerState.tournaments, activeWorkspace.id, config.date])
  const occupiedMatches = otherTournamentMatches.map((entry) => entry.match)
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams])
  const completed = matches.filter((match) => match.status === 'completed').length
  const managedMatches: ManagedMatch[] = useMemo(() => managerState.tournaments.flatMap((tournament, index) => tournament.state.matches.map((match) => ({
    tournamentId: tournament.id,
    tournamentLabel: tournament.label || `Torneo ${index + 1}`,
    match,
    matches: tournament.state.matches,
    teams: tournament.state.teams,
    config: tournament.state.config,
  }))), [managerState.tournaments])
  const playingMatches = managedMatches.filter((entry) => entry.match.status === 'playing')
  const currentPhaseByTournament = new Map(managerState.tournaments.map((tournament) => [
    tournament.id,
    tournament.state.phases.find((phase) => tournament.state.matches.some((match) => match.phaseId === phase.id && match.status !== 'completed'))?.id ?? tournament.state.phases.at(-1)?.id,
  ]))
  const liveTeamStats = new Map<string, { games: number; lastEnd: number }>()
  managedMatches.forEach((entry) => {
    if (entry.match.status !== 'completed' || entry.match.phaseId !== currentPhaseByTournament.get(entry.tournamentId)) return
    const ids = [resolveParticipantId(entry.match.teamAId, entry.matches), resolveParticipantId(entry.match.teamBId, entry.matches)].filter((id): id is string => Boolean(id))
    ids.forEach((id) => {
      const key = `${entry.tournamentId}:${id}`
      const previous = liveTeamStats.get(key)
      liveTeamStats.set(key, { games: (previous?.games ?? 0) + 1, lastEnd: Math.max(previous?.lastEnd ?? toMinute(entry.config.startTime), entry.match.endMinute) })
    })
  })
  const availableCourtFor = (entry: ManagedMatch) => [entry.match.court, ...Array.from({ length: config.courts }, (_, index) => index + 1).filter((court) => court !== entry.match.court)]
    .find((court) => canStartOnSharedCourts(entry.tournamentId, { ...entry.match, court }, entry.matches, playingMatches))
  const livePriority = (entry: ManagedMatch) => {
    const ids = [resolveParticipantId(entry.match.teamAId, entry.matches), resolveParticipantId(entry.match.teamBId, entry.matches)].filter((id): id is string => Boolean(id))
    const fallback = toMinute(entry.config.startTime)
    return ids.reduce((priority, id) => {
      const stats = liveTeamStats.get(`${entry.tournamentId}:${id}`)
      return { games: priority.games + (stats?.games ?? 0), lastEnd: priority.lastEnd + (stats?.lastEnd ?? fallback) }
    }, { games: 0, lastEnd: 0 })
  }
  const readyMatches = managedMatches.map((entry) => ({ ...entry, availableCourt: availableCourtFor(entry), priority: livePriority(entry) })).filter((entry) => entry.availableCourt !== undefined).sort((a, b) => a.priority.games - b.priority.games || a.priority.lastEnd - b.priority.lastEnd || a.match.startMinute - b.match.startMinute)
  const knownClubs = [...new Set(teams.map((team) => team.club.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'))
  let nextPhaseEntrants = teams.length
  const phaseEntrants = phases.map((phase) => {
    const entrants = nextPhaseEntrants
    nextPhaseEntrants = phase.format === 'groups' ? (phase.advanceAll ? entrants : phase.advancingTeams > 0 ? phase.advancingTeams : entrants) : 1
    return entrants
  })
  const customFormulaValid = isFormulaValid(teams.length, phases)
  const allParallelReady = managerState.tournaments.every((tournament) => tournament.state.phases.length === phases.length && isFormulaValid(tournament.state.teams.length, tournament.state.phases))
  const parallelPreviewSchedules = useMemo(
    () => view === 'design' && allParallelReady ? generateParallelMatches(managerState.tournaments.map((tournament) => ({
      id: tournament.id,
      teams: tournament.state.teams,
      config: tournament.state.config,
      phases: tournament.state.phases,
    }))) : null,
    [view, allParallelReady, managerState.tournaments],
  )
  const standalonePreviewMatches = useMemo(
    () => view === 'design' && teams.length > 1 && customFormulaValid ? generateMatches(teams, config, phases[0]?.format ?? 'groups', phases, occupiedMatches) : [],
    [view, teams, config, phases, customFormulaValid, occupiedMatches],
  )
  const customPreviewMatches = parallelPreviewSchedules?.[activeWorkspace.id] ?? standalonePreviewMatches
  const customMatchCount = customPreviewMatches.length
  const allPreviewMatches = parallelPreviewSchedules ? Object.values(parallelPreviewSchedules).flat() : customPreviewMatches
  const totalPreviewMatchCount = allPreviewMatches.length
  const activeEstimatedEndMinute = customPreviewMatches.length ? Math.max(...customPreviewMatches.map((match) => match.endMinute)) : toMinute(config.startTime)
  const estimatedEndMinute = allPreviewMatches.length ? Math.max(...allPreviewMatches.map((match) => match.endMinute)) : toMinute(config.startTime)
  const parallelEndTimes = parallelPreviewSchedules ? managerState.tournaments.map((tournament) => {
    const tournamentMatches = parallelPreviewSchedules[tournament.id] ?? []
    return { label: tournament.label, endMinute: tournamentMatches.length ? Math.max(...tournamentMatches.map((match) => match.endMinute)) : toMinute(config.startTime) }
  }) : []
  const earliestParallelEnd = parallelEndTimes.length ? Math.min(...parallelEndTimes.map((tournament) => tournament.endMinute)) : estimatedEndMinute
  const endTimeDifference = estimatedEndMinute - earliestParallelEnd
  const unequalParallelDuration = parallelEndTimes.length > 1 && endTimeDifference > 0
  const earliestTournament = parallelEndTimes.find((tournament) => tournament.endMinute === earliestParallelEnd)
  const deadlineMinute = tournamentEndMinute(config.startTime, config.endTime)
  const overTime = customFormulaValid && estimatedEndMinute > deadlineMinute
  const overtimeMinutes = Math.max(0, estimatedEndMinute - deadlineMinute)
  const suggestedGroups = new Map<string, number>()
  if (overTime) phases.forEach((phase, phaseIndex) => {
    if (phase.format !== 'groups') return
    const entrants = phaseEntrants[phaseIndex]
    const candidates = Array.from({ length: Math.max(1, Math.floor(entrants / 2)) }, (_, index) => index + 1)
      .map((count) => {
        if (count === phase.groupCount) return { count, candidateEnd: estimatedEndMinute }
        const candidatePhases = phases.map((item) => item.id === phase.id ? { ...item, groupCount: count } : item)
        const candidateAllMatches = allParallelReady
          ? Object.values(generateParallelMatches(managerState.tournaments.map((tournament) => ({
              id: tournament.id,
              teams: tournament.state.teams,
              config: tournament.state.config,
              phases: tournament.id === activeWorkspace.id ? candidatePhases : tournament.state.phases,
            })))).flat()
          : generateMatches(teams, config, candidatePhases[0]?.format ?? 'groups', candidatePhases, occupiedMatches)
        const candidateEnd = candidateAllMatches.length ? Math.max(...candidateAllMatches.map((match) => match.endMinute)) : toMinute(config.startTime)
        return { count, candidateEnd }
      })
      .sort((a, b) => {
        const aFits = a.candidateEnd <= deadlineMinute
        const bFits = b.candidateEnd <= deadlineMinute
        if (aFits !== bFits) return aFits ? -1 : 1
        if (aFits) return Math.abs(a.count - phase.groupCount) - Math.abs(b.count - phase.groupCount) || b.candidateEnd - a.candidateEnd
        return a.candidateEnd - b.candidateEnd || Math.abs(a.count - phase.groupCount) - Math.abs(b.count - phase.groupCount)
      })
    if (candidates[0] && candidates[0].count !== phase.groupCount) suggestedGroups.set(phase.id, candidates[0].count)
  })
  const phaseAdditionSuggestions: Array<{ label: string; description: string; phase: TournamentPhase; estimatedEnd: number }> = []
  const lastPhase = phases.at(-1)
  if (view === 'design' && customFormulaValid && !overTime && lastPhase?.format === 'groups' && teams.length > 1) {
    const entrants = phaseEntrants.at(-1) ?? teams.length
    const divisors = Array.from({ length: Math.max(1, Math.floor(entrants / 2)) }, (_, index) => index + 1).filter((count) => entrants % count === 0)
    const groupCount = divisors.sort((a, b) => Math.abs(entrants / a - 4) - Math.abs(entrants / b - 4))[0] ?? 1
    const suggestedKnockoutSize = knockoutSizesUpTo(entrants).at(-1) ?? 0
    const groupPhases = phases.filter((phase) => phase.format === 'groups')
    const nextComposition: GroupComposition | null = groupPhases.length < MAX_PHASES ? 'strength' : null
    const candidates: Array<{ label: string; description: string; phase: TournamentPhase }> = []
    if (nextComposition) candidates.push({
      label: 'Aggiungi gironi finali per livello',
      description: 'Raggruppa le squadre nelle rispettive fasce di classifica per determinare tutte le posizioni finali.',
      phase: { id: 'suggested-groups', name: 'Gironi finali', format: 'groups', groupCount, groupComposition: nextComposition, advanceAll: true, advancingTeams: entrants, thirdPlaceFinal: false },
    })
    candidates.push({
      label: 'Aggiungi eliminazione diretta',
      description: suggestedKnockoutSize === entrants ? `Crea un tabellone completo con tutte le ${entrants} squadre.` : `Qualifica ${suggestedKnockoutSize} squadre per creare un tabellone completo senza passaggi diretti.`,
      phase: { id: 'suggested-knockout', name: 'Fase finale', format: 'knockout', groupCount: 1, groupComposition: 'strength', advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    })
    candidates.forEach((candidate) => {
      const candidateState = appendSuggestedPhase(managerState, candidate.phase)
      const candidateReady = candidateState.tournaments.every((tournament) => isFormulaValid(tournament.state.teams.length, tournament.state.phases))
      if (!candidateReady) return
      const candidateMatches = Object.values(generateParallelMatches(candidateState.tournaments.map((tournament) => ({ id: tournament.id, teams: tournament.state.teams, config: tournament.state.config, phases: tournament.state.phases })))).flat()
      const candidateEnd = candidateMatches.length ? Math.max(...candidateMatches.map((match) => match.endMinute)) : estimatedEndMinute
      if (candidateEnd <= deadlineMinute) phaseAdditionSuggestions.push({ ...candidate, estimatedEnd: candidateEnd })
    })
  }

  useEffect(() => {
    try { localStorage.setItem(MULTI_STATE_KEY, JSON.stringify(managerState)) } catch { /* keep the in-memory tournament usable */ }
  }, [managerState])
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

  const hasStartedMatches = (workspaces: TournamentWorkspace[]) => workspaces.some((tournament) => tournament.state.matches.some((match) => match.status !== 'scheduled'))
  const confirmReset = (workspaces: TournamentWorkspace[], message: string) => !hasStartedMatches(workspaces) || window.confirm(message)
  const exportConfiguration = () => {
    const file: ConfigurationFile = {
      app: 'tournamanager',
      version: 1,
      tournaments: managerState.tournaments.map((tournament) => ({
        label: tournament.label,
        state: {
          config: tournament.state.config,
          teams: tournament.state.teams,
          selectedFormat: tournament.state.selectedFormat,
          phases: tournament.state.phases,
        },
      })),
    }
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const fileName = config.name.trim().toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'torneo'
    link.href = url
    link.download = `${fileName}.tournamanager.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const importConfiguration = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const imported = readConfigurationFile(await file.text())
      if (!window.confirm('Importare questa configurazione e sostituire quella corrente?')) return
      setManagerState(imported)
      setTeamTexts({})
      setTeamErrors({})
      setEditingMatch(null)
      setView('design')
    } catch {
      window.alert('Il file selezionato non è una configurazione TournaManager valida.')
    }
  }
  const updateConfig = <K extends keyof TournamentConfig>(key: K, value: TournamentConfig[K]) => {
    const sharedKeys: Array<keyof TournamentConfig> = ['name', 'date', 'startTime', 'endTime', 'courts', 'phaseBreakMinutes']
    if (sharedKeys.includes(key)) {
      const changesSchedule = ['startTime', 'endTime', 'courts', 'phaseBreakMinutes'].includes(key)
      if (changesSchedule && !confirmReset(managerState.tournaments, 'Questa modifica cancellerà calendario e risultati di tutti i tornei. Continuare?')) return
      setManagerState((current) => ({ ...current, tournaments: current.tournaments.map((tournament) => ({ ...tournament, state: { ...tournament.state, config: { ...tournament.state.config, [key]: value }, matches: changesSchedule ? [] : tournament.state.matches } })) }))
      return
    }
    if (!confirmReset([activeWorkspace], 'Questa modifica cancellerà calendario e risultati del torneo selezionato. Continuare?')) return
    setState((current) => ({ ...current, config: { ...current.config, [key]: value }, matches: [] }))
  }
  const updateSetsPerMatch = (value: number) => {
    const setsPerMatch = clampInteger(value, 1, MAX_SETS)
    if (!confirmReset([activeWorkspace], 'Cambiare il numero di set cancellerà calendario e risultati del torneo selezionato. Continuare?')) return
    setState((current) => ({
      ...current,
      config: { ...current.config, setsPerMatch, setPoints: Array.from({ length: setsPerMatch }, (_, index) => current.config.setPoints?.[index] ?? current.config.pointsPerSet) },
      matches: [],
    }))
  }
  const updateTournamentType = (tournamentType: TournamentType) => {
    if (tournamentType === config.tournamentType) return
    if (!confirmReset([activeWorkspace], 'Cambiare il tipo applicherà i set e i punti predefiniti e cancellerà calendario e risultati del sotto-torneo selezionato. Continuare?')) return
    const setPoints = matchDefaultsByTournamentType[tournamentType]
    setState((current) => ({
      ...current,
      config: { ...current.config, tournamentType, setsPerMatch: setPoints.length, pointsPerSet: setPoints[0], setPoints: [...setPoints] },
      matches: [],
    }))
  }
  const updateSetPoints = (index: number, value: number) => {
    if (!confirmReset([activeWorkspace], 'Cambiare il punteggio dei set cancellerà calendario e risultati del torneo selezionato. Continuare?')) return
    setState((current) => ({
      ...current,
      config: { ...current.config, setPoints: normalizeSetPoints(current.config).map((points, currentIndex) => currentIndex === index ? clampInteger(value, 1, 99) : points) },
      matches: [],
    }))
  }
  const updateTournamentLabel = (label: string) => setManagerState((current) => ({
    ...current, tournaments: current.tournaments.map((tournament) => tournament.id === current.activeId ? { ...tournament, label } : tournament),
  }))
  const importTeamText = () => {
    const nextTeams = parseTeams(teamText)
    if (nextTeams.length > MAX_TEAMS) {
      setTeamErrors((current) => ({ ...current, [activeWorkspace.id]: `Massimo ${MAX_TEAMS} squadre per torneo: l’elenco ne contiene ${nextTeams.length}.` }))
      return
    }
    if (!confirmReset([activeWorkspace], 'Importare nuovamente le squadre cancellerà calendario e risultati del torneo selezionato. Continuare?')) return
    setTeamErrors((current) => ({ ...current, [activeWorkspace.id]: '' }))
    setManagerState((current) => {
      const active = current.tournaments.find((tournament) => tournament.id === current.activeId) as TournamentWorkspace
      const templatePhases = active.state.phases.length ? active.state.phases : makeDefaultPhases(nextTeams.length)
      return { ...current, tournaments: current.tournaments.map((tournament, tournamentIndex) => {
        if (tournament.id === current.activeId) return { ...tournament, state: { ...tournament.state, teams: nextTeams, phases: templatePhases, matches: [] } }
        if (tournament.state.phases.length) return tournament
        return { ...tournament, state: { ...tournament.state, phases: templatePhases.map((phase, phaseIndex) => ({ ...phase, id: `phase-${phaseIndex + 1}-${tournamentIndex}` })), matches: [] } }
      }) }
    })
  }
  const createCustomTournament = () => {
    if (!confirmReset(managerState.tournaments, 'Rigenerare i calendari cancellerà tutti i risultati registrati. Continuare?')) return
    setManagerState((current) => {
      const prepared = current.tournaments.map((tournament) => {
        const groupPhase = tournament.state.phases.find((phase) => phase.format === 'groups')
        const finalPhase = tournament.state.phases.find((phase) => phase.format === 'knockout')
        const nextConfig = { ...tournament.state.config, groupCount: groupPhase?.groupCount ?? 1, finalTeams: finalPhase && groupPhase ? (groupPhase.advanceAll ? tournament.state.teams.length : groupPhase.advancingTeams) : 0, thirdPlaceFinal: finalPhase?.thirdPlaceFinal ?? false }
        return { ...tournament, state: { ...tournament.state, config: nextConfig, selectedFormat: tournament.state.phases[0]?.format ?? 'groups' as FormatKind } }
      })
      const schedules = generateParallelMatches(prepared.map((tournament) => ({ id: tournament.id, teams: tournament.state.teams, config: tournament.state.config, phases: tournament.state.phases })))
      return { ...current, tournaments: prepared.map((tournament) => ({ ...tournament, state: { ...tournament.state, matches: schedules[tournament.id] ?? [] } })) }
    })
    setView('structure')
  }
  const updatePhase = (id: string, patch: Partial<TournamentPhase>) => {
    if (!confirmReset([activeWorkspace], 'Modificare la formula cancellerà calendario e risultati del torneo selezionato. Continuare?')) return
    setState((current) => ({ ...current, phases: enforceFinalGroupComposition(current.phases.map((phase) => phase.id === id ? { ...phase, ...patch } : phase)), matches: [] }))
  }
  const updatePhaseFormat = (id: string, format: FormatKind) => {
    if (!confirmReset([activeWorkspace], 'Modificare la formula cancellerà calendario e risultati del torneo selezionato. Continuare?')) return
    setState((current) => {
      const phaseIndex = current.phases.findIndex((phase) => phase.id === id)
      if (phaseIndex < 0) return current
      let entrants = current.teams.length
      for (let index = 0; index < phaseIndex; index += 1) {
        const phase = current.phases[index]
        entrants = phase.format === 'groups' ? (phase.advanceAll ? entrants : phase.advancingTeams) : 1
      }
      const nextPhases = current.phases.map((phase, index) => index === phaseIndex ? {
        ...phase,
        format,
        groupCount: format === 'knockout' ? 1 : phase.groupCount,
        advanceAll: format === 'groups',
        advancingTeams: format === 'knockout' ? 1 : entrants,
      } : phase)
      if (format === 'knockout' && phaseIndex > 0 && nextPhases[phaseIndex - 1].format === 'groups') {
        let previousEntrants = current.teams.length
        for (let index = 0; index < phaseIndex - 1; index += 1) {
          const phase = nextPhases[index]
          previousEntrants = phase.format === 'groups' ? (phase.advanceAll ? previousEntrants : phase.advancingTeams) : 1
        }
        const knockoutSize = knockoutTeamCountsUpTo(previousEntrants, Math.max(1, nextPhases[phaseIndex].groupCount)).at(-1) ?? 0
        nextPhases[phaseIndex - 1] = { ...nextPhases[phaseIndex - 1], advanceAll: knockoutSize === previousEntrants, advancingTeams: knockoutSize }
      }
      return { ...current, phases: enforceFinalGroupComposition(nextPhases), matches: [] }
    })
  }
  const updateKnockoutBracketCount = (id: string, bracketCount: number) => {
    if (!confirmReset([activeWorkspace], 'Modificare i tabelloni cancellerà calendario e risultati del torneo selezionato. Continuare?')) return
    setState((current) => {
      const phaseIndex = current.phases.findIndex((phase) => phase.id === id)
      if (phaseIndex < 0) return current
      const nextPhases = current.phases.map((phase) => phase.id === id ? { ...phase, groupCount: bracketCount } : phase)
      if (phaseIndex > 0 && nextPhases[phaseIndex - 1].format === 'groups') {
        let previousEntrants = current.teams.length
        for (let index = 0; index < phaseIndex - 1; index += 1) {
          const phase = nextPhases[index]
          previousEntrants = phase.format === 'groups' ? (phase.advanceAll ? previousEntrants : phase.advancingTeams) : 1
        }
        const advancingTeams = knockoutTeamCountsUpTo(previousEntrants, bracketCount).at(-1) ?? 0
        nextPhases[phaseIndex - 1] = { ...nextPhases[phaseIndex - 1], advanceAll: advancingTeams === previousEntrants, advancingTeams }
      }
      return { ...current, phases: nextPhases, matches: [] }
    })
  }
  const updateTeamClub = (id: string, club: string) => {
    if (!confirmReset([activeWorkspace], 'Cambiare la società cancellerà calendario e risultati del torneo selezionato. Continuare?')) return
    setState((current) => ({ ...current, teams: current.teams.map((team) => team.id === id ? { ...team, club } : team), matches: [] }))
  }
  const removePhase = (id: string) => {
    if (!confirmReset(managerState.tournaments, 'Rimuovere una fase cancellerà calendario e risultati di tutti i tornei. Continuare?')) return
    const phaseIndex = phases.findIndex((phase) => phase.id === id)
    setManagerState((current) => ({ ...current, tournaments: current.tournaments.map((tournament) => ({ ...tournament, state: { ...tournament.state, phases: enforceFinalGroupComposition(tournament.state.phases.filter((_, index) => index !== phaseIndex)), matches: [] } })) }))
  }
  const addPhase = () => {
    if (phases.length >= MAX_PHASES) return
    if (!confirmReset(managerState.tournaments, 'Aggiungere una fase cancellerà calendario e risultati di tutti i tornei. Continuare?')) return
    const lastIsKnockout = managerState.tournaments.some((tournament) => tournament.state.phases.at(-1)?.format === 'knockout')
    const insertionIndex = lastIsKnockout ? phases.length - 1 : phases.length
    setManagerState((current) => ({ ...current, tournaments: current.tournaments.map((tournament, tournamentIndex) => {
      let entrants = tournament.state.teams.length
      for (let index = 0; index < insertionIndex; index += 1) {
        const phase = tournament.state.phases[index]
        if (phase?.format === 'groups' && phase.advancingTeams > 0) entrants = phase.advanceAll ? entrants : phase.advancingTeams
      }
      const divisors = Array.from({ length: Math.max(1, Math.floor(entrants / 2)) }, (_, index) => index + 1).filter((count) => entrants % count === 0)
      const groupCount = divisors.sort((a, b) => Math.abs(entrants / a - 4) - Math.abs(entrants / b - 4))[0] ?? 1
      const followingKnockout = tournament.state.phases[insertionIndex]
      const advancingTeams = lastIsKnockout ? knockoutTeamCountsUpTo(entrants, Math.max(1, followingKnockout?.groupCount ?? 1)).at(-1) ?? entrants : entrants
      const next: TournamentPhase = { id: `phase-${Date.now()}-${tournamentIndex}`, name: `Fase ${insertionIndex + 1}`, format: 'groups', groupCount, groupComposition: 'strength', advanceAll: advancingTeams === entrants, advancingTeams, thirdPlaceFinal: false }
      const nextPhases = [...tournament.state.phases]
      nextPhases.splice(insertionIndex, 0, next)
      return { ...tournament, state: { ...tournament.state, phases: nextPhases, matches: [] } }
    }) }))
  }
  const applyPhaseSuggestion = (suggestedPhase: TournamentPhase) => {
    if (!confirmReset(managerState.tournaments, 'Aggiungere la fase suggerita cancellerà calendario e risultati di tutti i tornei. Continuare?')) return
    setManagerState((current) => appendSuggestedPhase(current, suggestedPhase))
  }
  const updateMatch = (tournamentId: string, id: string, patch: Partial<Match>) => setManagerState((current) => ({
    ...current,
    tournaments: current.tournaments.map((tournament) => tournament.id === tournamentId ? {
      ...tournament,
      state: { ...tournament.state, matches: tournament.state.matches.map((match) => match.id === id ? { ...match, ...patch } : match) },
    } : tournament),
  }))
  const startMatch = (tournamentId: string, id: string) => setManagerState((current) => {
    const allMatches: ManagedMatch[] = current.tournaments.flatMap((tournament, index) => tournament.state.matches.map((match) => ({
      tournamentId: tournament.id, tournamentLabel: tournament.label || `Torneo ${index + 1}`, match,
      matches: tournament.state.matches, teams: tournament.state.teams, config: tournament.state.config,
    })))
    const candidate = allMatches.find((entry) => entry.tournamentId === tournamentId && entry.match.id === id)
    if (!candidate) return current
    const playing = allMatches.filter((entry) => entry.match.status === 'playing')
    const availableCourt = [candidate.match.court, ...Array.from({ length: candidate.config.courts }, (_, index) => index + 1).filter((court) => court !== candidate.match.court)]
      .find((court) => canStartOnSharedCourts(tournamentId, { ...candidate.match, court }, candidate.matches, playing))
    if (!availableCourt) return current
    return { ...current, tournaments: current.tournaments.map((tournament) => tournament.id === tournamentId ? {
      ...tournament, state: { ...tournament.state, matches: tournament.state.matches.map((match) => match.id === id ? { ...match, court: availableCourt, status: 'playing' } : match) },
    } : tournament) }
  })
  const saveMatchResult = (tournamentId: string, changedMatch: Match, sets: SetScore[]) => {
    const workspace = managerState.tournaments.find((tournament) => tournament.id === tournamentId)
    if (!workspace) return
    const dependentIds = dependentMatchIds(workspace.state.matches, changedMatch)
    const recordedDependents = workspace.state.matches.filter((match) => dependentIds.has(match.id) && (match.status !== 'scheduled' || match.sets.length > 0))
    if (recordedDependents.length && !window.confirm(`Questo risultato determina ${recordedDependents.length} partite già avviate o concluse. I relativi risultati verranno cancellati. Continuare?`)) return
    setManagerState((current) => ({ ...current, tournaments: current.tournaments.map((tournament) => tournament.id === tournamentId ? {
      ...tournament, state: { ...tournament.state, matches: tournament.state.matches.map((match) => match.id === changedMatch.id
        ? { ...match, sets, status: 'completed' }
        : dependentIds.has(match.id) ? { ...match, sets: [], status: 'scheduled' } : match) },
    } : tournament) }))
    setEditingMatch(null)
  }
  const deleteMatchResult = (tournamentId: string, changedMatch: Match) => {
    const workspace = managerState.tournaments.find((tournament) => tournament.id === tournamentId)
    if (!workspace) return
    const dependentIds = dependentMatchIds(workspace.state.matches, changedMatch)
    const dependentWarning = dependentIds.size ? ` Verranno azzerate anche ${dependentIds.size} partite successive.` : ''
    if (!window.confirm(`Sei sicuro di voler eliminare questo risultato?${dependentWarning}`)) return
    setManagerState((current) => ({ ...current, tournaments: current.tournaments.map((tournament) => tournament.id === tournamentId ? {
      ...tournament,
      state: { ...tournament.state, matches: tournament.state.matches.map((match) => match.id === changedMatch.id || dependentIds.has(match.id)
        ? { ...match, sets: [], status: 'scheduled' }
        : match) },
    } : tournament) }))
    setEditingMatch(null)
  }
  const resetDemo = () => {
    if (!confirmReset([activeWorkspace], 'Ripristinare la demo cancellerà calendario e risultati del torneo selezionato. Continuare?')) return
    const demoNames = demoTournamentTeamNames[activeTournamentIndex] ?? demoTeamNames
    const nextTeams = parseTeams(demoNames.join('\n'))
    const defaults = makeDefaultPhases(nextTeams.length)
    const nextPhases = phases.length ? phases.map((phase, index) => index === 0 && phase.format === 'groups' ? { ...phase, groupCount: defaults[0]?.groupCount ?? phase.groupCount, advanceAll: true, advancingTeams: nextTeams.length } : phase) : defaults
    setTeamText(demoNames.join('\n'))
    setState({ config: { ...config }, teams: nextTeams, selectedFormat: 'groups', phases: nextPhases, matches: [] })
    setView('design')
  }
  const selectTournament = (id: string) => {
    setManagerState((current) => ({ ...current, activeId: id }))
    setEditingMatch(null)
  }
  const setTournamentCount = (count: number) => {
    const nextCount = Math.max(1, Math.round(count))
    if (nextCount === managerState.tournaments.length) return
    const removingData = nextCount < managerState.tournaments.length && managerState.tournaments.slice(nextCount).some((tournament) => tournament.state.teams.length || tournament.state.matches.length)
    const warning = removingData ? 'Riducendo il numero di tornei perderai definitivamente squadre, formula e risultati dei tornei rimossi. Continuare?' : 'Cambiare il numero di tornei richiede di rigenerare i calendari condivisi. Continuare?'
    if ((removingData || managerState.tournaments.some((tournament) => tournament.state.matches.length)) && !window.confirm(warning)) return
    setManagerState((current) => {
      const tournaments = current.tournaments.slice(0, nextCount)
      while (tournaments.length < nextCount) {
        const id = `tournament-${Date.now()}-${tournaments.length}`
        const tournamentIndex = tournaments.length
        tournaments.push({ id, label: `Torneo ${tournamentIndex + 1}`, state: makeBlankTournament(current.tournaments[0].state.config, current.tournaments[0].state.phases, tournamentIndex) })
      }
      return { tournaments: tournaments.map((tournament) => ({ ...tournament, state: { ...tournament.state, matches: [] } })), activeId: tournaments.some((tournament) => tournament.id === current.activeId) ? current.activeId : tournaments[0].id }
    })
    setEditingMatch(null)
  }
  const removeTournament = (id: string) => {
    if (managerState.tournaments.length <= 1) return
    const target = managerState.tournaments.find((tournament) => tournament.id === id)
    if (!target) return
    if ((target.state.teams.length > 0 || target.state.matches.length > 0) && !window.confirm(`Rimuovere “${target.label}”? Squadre, formula e risultati di questo torneo verranno eliminati.`)) return
    setManagerState((current) => {
      const tournaments = current.tournaments.filter((tournament) => tournament.id !== id)
      return {
        tournaments,
        activeId: current.activeId === id ? tournaments[0].id : current.activeId,
      }
    })
    setTeamTexts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setTeamErrors((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setEditingMatch(null)
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
  const editingWorkspace = editingMatch ? managerState.tournaments.find((tournament) => tournament.id === editingMatch.tournamentId) : undefined

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Trophy size={21} /></span><span>Tourna<strong>Manager</strong></span></div>
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
      <div className="tournament-bar"><span>Tornei paralleli</span><div>{managerState.tournaments.map((tournament, index) => <article className={tournament.id === activeWorkspace.id ? 'active' : ''} key={tournament.id}><button onClick={() => selectTournament(tournament.id)}><i />{tournament.label || `Torneo ${index + 1}`}<small>{tournament.state.matches.filter((match) => match.status === 'playing').length ? 'live' : `${tournament.state.teams.length} squadre`}</small></button>{managerState.tournaments.length > 1 && <button className="remove-tournament" aria-label={`Rimuovi ${tournament.label || `Torneo ${index + 1}`}`} title="Rimuovi torneo" onClick={() => removeTournament(tournament.id)}><Trash2 size={14} /></button>}</article>)}<button className="add-tournament" onClick={() => setTournamentCount(managerState.tournaments.length + 1)}><Plus size={14} /> Aggiungi torneo</button></div><small>{managerState.tournaments.length} simultane{managerState.tournaments.length === 1 ? 'o' : 'i'}</small></div>
      {view === 'design' && <div className="page design-page">
        <section className="hero">
          <div><span className="pill">Configurazione</span><h2>Configura il torneo</h2><p>Imposta squadre, orari, campi e numero di partite.</p></div>
          <div className="hero-stats"><Metric value={teams.length} label="squadre" /><Metric value={config.courts} label="campi" /><Metric value={phases.length || '—'} label="fasi" /></div>
        </section>
        <div className="configuration-transfer">
          <input ref={importInputRef} type="file" accept="application/json,.json" onChange={importConfiguration} />
          <button className="button secondary" onClick={() => importInputRef.current?.click()}><Upload size={16} /> Importa configurazione</button>
          <button className="button secondary" onClick={exportConfiguration}><Download size={16} /> Esporta configurazione</button>
        </div>

        <div className="two-columns">
          <section className="panel setup-panel">
            <div className="section-title"><span>01</span><div><h3>Impostazioni torneo</h3><p>Tempi, spazi e carico di gioco</p></div></div>
            <div className="form-grid">
              <label className="field wide"><span>Nome torneo</span><input value={config.name} onChange={(event) => updateConfig('name', event.target.value)} /></label>
              <label className="field"><span>Data</span><input type="date" value={config.date} onChange={(event) => updateConfig('date', event.target.value)} /></label>
              <NumberField label="Numero di tornei" value={managerState.tournaments.length} onChange={setTournamentCount} min={1} />
              <NumberField label="Campi disponibili" value={config.courts} onChange={(value) => updateConfig('courts', value)} min={1} max={MAX_COURTS} />
              <label className="field"><span>Inizio</span><input type="time" value={config.startTime} onChange={(event) => updateConfig('startTime', event.target.value)} /></label>
              <label className="field"><span>Fine</span><input type="time" value={config.endTime} onChange={(event) => updateConfig('endTime', event.target.value)} /></label>
              <NumberField label="Pausa tra le fasi" value={config.phaseBreakMinutes} onChange={(value) => updateConfig('phaseBreakMinutes', value)} min={0} max={240} suffix="min" />
            </div>
            <div className="subsection"><div><h4>Torneo {activeTournamentIndex + 1} · formato delle partite</h4><p>Tipo, set e punti sono indipendenti per ciascun sotto-torneo</p></div></div>
            <label className="field subtournament-name"><span>Nome del sotto-torneo</span><input value={activeWorkspace.label} placeholder={`Torneo ${activeTournamentIndex + 1}`} onChange={(event) => updateTournamentLabel(event.target.value)} /></label>
            <div className="number-grid">
              <label className="field"><span>Tipo torneo</span><select value={config.tournamentType} onChange={(event) => updateTournamentType(event.target.value as TournamentType)}><option value="s3-red">S3 Red</option><option value="s3-green">S3 Green</option><option value="s3-white">S3 White</option><option value="6v6">6 contro 6</option></select></label>
              <NumberField label="Set per partita" value={config.setsPerMatch} onChange={updateSetsPerMatch} min={1} max={MAX_SETS} />
            </div>
            <div className="set-points-grid">{normalizeSetPoints(config).map((points, index) => <NumberField key={index} label={`Punti set ${index + 1}`} value={points} onChange={(value) => updateSetPoints(index, value)} min={1} max={99} />)}</div>
            <div className="match-duration-estimate"><Clock3 size={16} /><span>Durata stimata per partita · {tournamentTypeLabels[config.tournamentType]}</span><strong>~{estimateMatchMinutes(config)} min</strong><small>{normalizeSetPoints(config).join(' + ')} punti · {tournamentPaceLabels[config.tournamentType]} · 3 min tra i set</small></div>
          </section>

          <section className="panel teams-panel">
            <div className="section-title"><span>02</span><div><h3>Squadre partecipanti</h3><p>Una per riga, oppure incolla da Excel</p></div><b>{teams.length}</b></div>
            <textarea value={teamText} onChange={(event) => setTeamText(event.target.value)} aria-label="Elenco squadre" />
            <div className="paste-footer"><span><ClipboardList size={16} /> Duplicati e righe vuote saranno rimossi</span><button className="button dark" onClick={importTeamText}><Users size={17} /> Importa elenco</button></div>
            {teamErrors[activeWorkspace.id] && <p className="phase-error">{teamErrors[activeWorkspace.id]}</p>}
            {teams.length > 0 && <section className="club-editor">
              <header><div><h4>Società delle squadre</h4><p>Riconosciute dal nome. Correggile se necessario: nella prima fase verranno separate il più possibile.</p></div><span>{knownClubs.length} riconosciute</span></header>
              <datalist id="club-options">{knownClubs.map((club) => <option value={club} key={club} />)}</datalist>
              <div>{teams.map((team) => <label key={team.id}><span>{team.name}</span><input list="club-options" value={team.club} placeholder="Nessuna società" onChange={(event) => updateTeamClub(team.id, event.target.value)} /></label>)}</div>
            </section>}
          </section>
        </div>

        <section className="suggestions-section">
          <section className="custom-formula panel">
            <div className="custom-formula-heading">
              <div><span className="eyebrow">03 · Formula · Torneo {activeTournamentIndex + 1}</span><h2>Costruisci le fasi del torneo</h2><p>Il numero e la finestra temporale delle fasi sono comuni; formato e impostazioni possono cambiare per ogni torneo.</p></div>
              <button className="button secondary" disabled={phases.length >= MAX_PHASES} onClick={addPhase}><Plus size={17} /> Aggiungi fase</button>
            </div>
            {teams.length > 1 && <div className={`efficiency-status ${parallelPreviewSchedules && managerState.tournaments.length > 1 ? 'multi' : ''} ${overTime || unequalParallelDuration ? 'warning' : 'ok'}`}>
              <div><strong>{parallelPreviewSchedules ? totalPreviewMatchCount : customMatchCount}</strong><span>{parallelPreviewSchedules && managerState.tournaments.length > 1 ? 'partite complessive' : 'partite previste'}</span></div><div><strong>{formatMinute(activeEstimatedEndMinute)}</strong><span>fine {activeWorkspace.label || `torneo ${activeTournamentIndex + 1}`}</span></div>{parallelPreviewSchedules && managerState.tournaments.length > 1 && <div className={unequalParallelDuration ? 'end-mismatch' : ''}><strong>{formatMinute(estimatedEndMinute)}</strong><span>{unequalParallelDuration ? `orari diversi · ${endTimeDifference} min` : 'fine comune'}</span></div>}<div><strong>{config.endTime}</strong><span>ora limite</span></div><p>{overTime ? `Il calendario supera l’orario di ${overtimeMinutes} minuti.` : unequalParallelDuration ? `${earliestTournament?.label || 'Un torneo'} termina ${endTimeDifference} minuti prima dell’ultimo.` : parallelPreviewSchedules && managerState.tournaments.length > 1 ? 'I tornei terminano insieme.' : 'Il calendario rientra nell’orario.'}</p>
            </div>}
            <div className="phase-editor-list">
              {phases.map((phase, index) => {
                const entrants = phaseEntrants[index]
                const isLast = index === phases.length - 1
                const minimumTeamsPerGroup = Math.floor(entrants / Math.max(1, phase.groupCount))
                const maximumTeamsPerGroup = Math.ceil(entrants / Math.max(1, phase.groupCount))
                const teamsPerGroupLabel = minimumTeamsPerGroup === maximumTeamsPerGroup ? `${minimumTeamsPerGroup}` : `${minimumTeamsPerGroup}–${maximumTeamsPerGroup}`
                const nextIsKnockout = phases[index + 1]?.format === 'knockout'
                const nextBracketCount = Math.max(1, phases[index + 1]?.groupCount ?? 1)
                const validKnockoutSizes = knockoutTeamCountsUpTo(entrants, nextBracketCount)
                const knockoutAvailableTeams = index > 0 && phases[index - 1]?.format === 'groups' ? phaseEntrants[index - 1] : entrants
                const validBracketCounts = Array.from({ length: Math.max(1, Math.floor(knockoutAvailableTeams / 2)) }, (_, bracketIndex) => bracketIndex + 1).filter((count) => index === 0 ? isBalancedKnockout(entrants, count) : knockoutTeamCountsUpTo(knockoutAvailableTeams, count).length > 0)
                const balancedCounts = balancedGroupCounts(entrants)
                const timeSuggestedCount = suggestedGroups.get(phase.id)
                return <article className="phase-editor" key={phase.id}>
                  <header><span>{index + 1}</span><label className="phase-name"><small>Nome fase</small><input value={phase.name} onChange={(event) => updatePhase(phase.id, { name: event.target.value })} /></label><div className="phase-team-count"><strong>{entrants}</strong><small>squadre in ingresso</small></div><button className="icon-button danger" onClick={() => removePhase(phase.id)} aria-label={`Rimuovi ${phase.name}`}><Trash2 size={17} /></button></header>
                  <div className="phase-fields">
                    <label className="field"><span>Formato</span><select value={phase.format} onChange={(event) => updatePhaseFormat(phase.id, event.target.value as FormatKind)}><option value="groups">Gironi all’italiana</option><option value="knockout">Eliminazione diretta</option></select></label>
                    {phase.format === 'groups' ? <>
                      {index > 0 && <label className="field"><span>Composizione gironi</span><select value={isLast ? 'strength' : phase.groupComposition} disabled={isLast} onChange={(event) => updatePhase(phase.id, { groupComposition: event.target.value as GroupComposition })}><option value="strength">Per fascia di classifica</option>{!isLast && <option value="cross">Fasce di classifica incrociate</option>}</select>{isLast && <small>Obbligatorio nella fase conclusiva</small>}</label>}
                      <label className="field"><span>Numero di gironi</span><select value={phase.groupCount} onChange={(event) => updatePhase(phase.id, { groupCount: Number(event.target.value) })}>{Array.from({ length: Math.max(1, Math.floor(entrants / 2)) }, (_, groupIndex) => groupIndex + 1).map((count) => {
                        const balanced = balancedCounts.includes(count)
                        const suggestedForTime = count === timeSuggestedCount
                        const minimum = Math.floor(entrants / count)
                        const maximum = Math.ceil(entrants / count)
                        const sizeLabel = minimum === maximum ? `${minimum} squadre ciascuno` : `${minimum}–${maximum} squadre`
                        return <option className={balanced || suggestedForTime ? 'suggested-option' : ''} value={count} key={count}>{count} {count === 1 ? 'girone' : 'gironi'} · {sizeLabel}{balanced && !suggestedForTime ? ' · consigliato' : ''}{suggestedForTime ? ' · consigliato per i tempi' : ''}</option>
                      })}</select></label>
                      {!isLast && <label className="check-field advance-all"><input type="checkbox" checked={phase.advanceAll} onChange={(event) => {
                        if (event.target.checked && nextIsKnockout && !isBalancedKnockout(entrants, nextBracketCount)) return
                        updatePhase(phase.id, { advanceAll: event.target.checked, advancingTeams: event.target.checked ? entrants : nextIsKnockout ? validKnockoutSizes.at(-1) ?? 2 : Math.min(entrants, Math.max(1, phase.advancingTeams)) })
                      }} /> Passano tutte</label>}
                      {!isLast && !phase.advanceAll && (nextIsKnockout ? <label className="field"><span>Squadre alla fase finale</span><select value={phase.advancingTeams} onChange={(event) => updatePhase(phase.id, { advancingTeams: Number(event.target.value) })}>{!validKnockoutSizes.includes(phase.advancingTeams) && <option value={phase.advancingTeams} disabled>{phase.advancingTeams} squadre · non valido</option>}{validKnockoutSizes.map((size) => <option value={size} key={size}>{size} squadre · tabellone completo</option>)}</select></label> : <NumberField label="Squadre alla fase successiva" value={phase.advancingTeams} onChange={(value) => updatePhase(phase.id, { advancingTeams: Math.max(1, Math.min(entrants, value)) })} min={1} />)}
                      <div className="phase-summary">{teamsPerGroupLabel} squadre per girone{isLast ? ' · classifica finale' : phase.advanceAll ? ' · passano tutte' : ` · ${phase.advancingTeams} passano`}</div>
                    </> : <>
                      <label className="field"><span>Tabelloni paralleli</span><select value={phase.groupCount} onChange={(event) => updateKnockoutBracketCount(phase.id, Number(event.target.value))}>{!validBracketCounts.includes(phase.groupCount) && <option value={phase.groupCount} disabled>{phase.groupCount} · configurazione non valida</option>}{validBracketCounts.map((count) => { const total = index === 0 ? entrants : knockoutTeamCountsUpTo(knockoutAvailableTeams, count).at(-1) as number; return <option value={count} key={count}>{count === 1 ? `1 tabellone da ${total}` : `${count} tabelloni da ${total / count}`}</option> })}</select></label>
                      <label className="check-field"><input type="checkbox" checked={phase.thirdPlaceFinal} onChange={(event) => updatePhase(phase.id, { thirdPlaceFinal: event.target.checked })} /> Finale 3° posto</label>
                      <div className="phase-summary">{phase.groupCount === 1 ? `Tabellone da ${entrants} squadre` : `${phase.groupCount} tabelloni da ${entrants / Math.max(1, phase.groupCount)} squadre`} · chi vince avanza</div>
                    </>}
                  </div>
                  {phase.format === 'knockout' && !isLast && <p className="phase-error">L’eliminazione diretta deve essere l’ultima fase.</p>}
                  {phase.format === 'knockout' && isLast && !isBalancedKnockout(entrants, phase.groupCount) && <p className="phase-error">Ogni tabellone deve contenere 2, 4, 8, 16… squadre: nessuna squadra può saltare un turno.</p>}
                </article>
              })}
              {phases.length === 0 && <div className="empty-phases"><GitBranch size={27} /><p>Nessuna fase. Aggiungine una per costruire la formula.</p></div>}
            </div>
            {phaseAdditionSuggestions.length > 0 && <section className="phase-suggestions">
              <header><span className="eyebrow">Possibili fasi successive</span><p>Entrano nei tempi senza cambiare i vincoli del torneo.</p></header>
              <div>{phaseAdditionSuggestions.map((suggestion) => <article key={suggestion.phase.id}><div><strong>{suggestion.label}</strong><p>{suggestion.description} Fine stimata: {formatMinute(suggestion.estimatedEnd)}.</p></div><button className="button secondary" type="button" onClick={() => applyPhaseSuggestion(suggestion.phase)}><Plus size={15} /> Aggiungi</button></article>)}</div>
            </section>}
            <footer className="custom-formula-footer"><p>{allParallelReady ? `Tutti i ${managerState.tournaments.length} tornei hanno ${phases.length} fasi valide.` : 'Configura squadre e lo stesso numero di fasi in tutti i tornei prima di generare.'}</p><button className="button primary" disabled={!allParallelReady} onClick={createCustomTournament}><Play size={16} /> Genera calendari</button></footer>
          </section>
        </section>
      </div>}

      {view === 'structure' && <StructureView config={config} teams={teams} matches={matches} selectedFormat={selectedFormat} phases={phases} onConfigure={() => setView('design')} onStart={() => setView('control')} />}

      {view === 'schedule' && <div className="page">
        <div className="page-heading"><div><span className="eyebrow">Calendario condiviso</span><h2>Partite per campo</h2><p>Le gare degli altri tornei sono mostrate come occupazioni del campo.</p></div><div className="heading-metrics"><Metric value={managedMatches.length} label="incontri totali" /><Metric value={managedMatches.length ? formatMinute(Math.max(...managedMatches.map((entry) => entry.match.endMinute))) : '—'} label="fine complessiva" /></div></div>
        {managedMatches.length === 0 ? <EmptyState icon={CalendarDays} title="Il calendario non è ancora stato generato" action={() => setView('design')} /> : <div className="court-board">
          {Array.from({ length: config.courts }, (_, index) => index + 1).map((court) => <section className="court-column" key={court}>
            <header><div><MapPin size={17} /> Campo {court}</div><span>{matches.filter((m) => m.court === court).length} gare · {otherTournamentMatches.filter((entry) => entry.match.court === court).length} condivise</span></header>
            <div className="court-matches">{[
              ...matches.filter((match) => match.court === court).map((match) => ({ match, external: false as const })),
              ...otherTournamentMatches.filter((entry) => entry.match.court === court).map((entry) => ({ ...entry, external: true as const })),
            ].sort((a, b) => a.match.startMinute - b.match.startMinute).map((entry) => entry.external
              ? <article className="match-card shared-match" key={`${entry.tournamentId}-${entry.match.id}`}><div className="match-time"><time>{formatMinute(entry.match.startMinute)}</time><span>{entry.tournamentName}</span></div><div className="match-team"><b>{entry.teamA}</b></div><div className="match-team"><b>{entry.teamB}</b></div><footer><MapPin size={11} /> Campo occupato da un altro torneo</footer></article>
              : <MatchCard key={entry.match.id} match={entry.match} matches={matches} teamById={teamById} onEdit={() => setEditingMatch({ tournamentId: activeWorkspace.id, match: entry.match })} />)}</div>
          </section>)}
        </div>}
      </div>}

      {view === 'control' && <div className="page control-page">
        <div className="page-heading"><div><span className="eyebrow live"><i /> Regia condivisa</span><h2>Gestione incontri</h2><p>Tutti i sotto-tornei e tutti i campi in un’unica vista.</p></div><div className="heading-metrics"><Metric value={`${managedMatches.filter((entry) => entry.match.status === 'completed').length}/${managedMatches.length}`} label="concluse" /><Metric value={playingMatches.length} label="in campo" /></div></div>
        {managedMatches.length === 0 ? <EmptyState icon={Play} title="Crea prima il torneo e il suo calendario" action={() => setView('design')} /> : <>
          <div className="live-courts">{Array.from({ length: config.courts }, (_, index) => index + 1).map((court) => {
            const activeOnCourt = playingMatches.filter((entry) => entry.match.court === court)
            return <section className={`live-court ${activeOnCourt.length ? 'busy' : ''}`} key={court}>
              <header><span><MapPin size={17} /> Campo {court}</span><b>{activeOnCourt.length ? `${activeOnCourt.length} in gioco` : 'Libero'}</b></header>
              {activeOnCourt.length ? <div className="live-active-list">{activeOnCourt.map((active) => {
                const activeTeamById = new Map(active.teams.map((team) => [team.id, team]))
                return <article key={`${active.tournamentId}-${active.match.id}`}><small>{active.tournamentLabel}</small>
                  <div className="live-matchup"><ParticipantBadge source={active.match.teamAId} matches={active.matches} teamById={activeTeamById} /><strong>VS</strong><ParticipantBadge source={active.match.teamBId} matches={active.matches} teamById={activeTeamById} /></div>
                  <div className="court-actions"><button className="button secondary" onClick={() => updateMatch(active.tournamentId, active.match.id, { status: 'scheduled' })}>Rimetti in coda</button><button className="button primary" onClick={() => setEditingMatch({ tournamentId: active.tournamentId, match: active.match })}><Save size={16} /> Risultato</button></div>
                </article>
              })}</div> : <div className="free-court"><Check size={24} /><p>Pronto per la prossima partita</p></div>}
            </section>
          })}</div>
        </>}
        {managedMatches.length > 0 && <LivePhaseOverview matches={matches} teams={teams} phases={phases} readyCourts={new Map(readyMatches.filter((entry) => entry.tournamentId === activeWorkspace.id).map((entry) => [entry.match.id, entry.availableCourt as number]))} suggestedMatchId={readyMatches.find((entry) => entry.tournamentId === activeWorkspace.id)?.match.id} onStart={(match) => startMatch(activeWorkspace.id, match.id)} onEdit={(match) => setEditingMatch({ tournamentId: activeWorkspace.id, match })} />}
      </div>}
    </main>
    {editingMatch && editingWorkspace && <ResultEditor match={editingMatch.match} matches={editingWorkspace.state.matches} teams={editingWorkspace.state.teams} config={editingWorkspace.state.config} onClose={() => setEditingMatch(null)} onSave={(sets) => saveMatchResult(editingMatch.tournamentId, editingMatch.match, sets)} onDelete={() => deleteMatchResult(editingMatch.tournamentId, editingMatch.match)} />}
  </div>
}

function MatchCard({ match, matches, teamById, onEdit }: { match: Match; matches: Match[]; teamById: Map<string, Team>; onEdit: () => void }) {
  const result = getSetWinner(match.sets)
  const ready = Boolean(resolveParticipantId(match.teamAId, matches) && resolveParticipantId(match.teamBId, matches))
  return <button className={`match-card ${match.status}`} disabled={!ready} onClick={onEdit}>
    <div className="match-time"><time>{formatMinute(match.startMinute)}</time><span>{match.pool ? `Girone ${match.pool}` : match.phaseName}</span></div>
    <div className="match-team"><ParticipantBadge source={match.teamAId} matches={matches} teamById={teamById} />{match.status === 'completed' && <b>{result.a}</b>}</div>
    <div className="match-team"><ParticipantBadge source={match.teamBId} matches={matches} teamById={teamById} />{match.status === 'completed' && <b>{result.b}</b>}</div>
    <footer>{match.status === 'completed' ? <><Check size={14} /> Conclusa</> : 'Inserisci risultato'}</footer>
  </button>
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
  const effectiveFormat = phases[0]?.format ?? selectedFormat

  if (teams.length < 2) return <div className="page"><EmptyState icon={GitBranch} title="Inserisci almeno due squadre" action={onConfigure} /></div>

  const customMultiStage = phases.length > 1
  if (customMultiStage) {
    const sourceLabel = (source: string) => {
      const resolved = resolveParticipantId(source, previewMatches)
      if (resolved && teamById.has(resolved)) return teamById.get(resolved) as string
      if (teamById.has(source)) return teamById.get(source) as string
      const rank = source.match(/^rank:pool-([^:]+):(\d+)$/)
      if (rank) return `${rank[2]}ª classificata · Girone ${rank[1]}`
      const best = source.match(/^best:phase-(\d+):rank-(\d+):(\d+)$/)
      if (best) return `Qualificata tra le migliori ${best[2]}ª · Fase ${best[1]}`
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
        const bestQualifiers = phase.advanceAll ? 0 : phase.advancingTeams % Math.max(1, phase.groupCount)
        return <section className={`phase-block ${phase.format === 'knockout' ? 'finals-phase' : ''}`} key={phase.id}>
          <header className="phase-heading"><div><span>Fase {phaseIndex + 1}</span><h3>{phase.name}</h3></div><p>{phase.format === 'groups' ? `${phase.groupCount} gironi${phaseIndex > 0 ? phase.groupComposition === 'cross' ? ' · fasce incrociate' : ' · fasce di classifica' : ''}${phaseIndex < phases.length - 1 ? phase.advanceAll ? ' · passano tutte' : ` · ${phase.advancingTeams} qualificate` : ''}` : phase.groupCount > 1 ? `${phase.groupCount} tabelloni paralleli per posizioni finali` : 'Eliminazione diretta'}</p></header>
          {phase.format === 'groups' ? <div className="pools-grid">{phasePools.map((pool) => <article className="pool-card" key={pool.name}>
            <header><h4>Girone {pool.name.replace(/^\d+/, '')}</h4><span>{pool.teams.length} squadre</span></header>
            <ol>{pool.teams.map((source) => <li key={source}>{sourceLabel(source)}</li>)}</ol>
            {phaseIndex < phases.length - 1 && <footer>{phase.advanceAll ? 'Passano tutte' : `${qualifiersPerPool ? `Passano le prime ${qualifiersPerPool}` : 'Nessun passaggio diretto'}${bestQualifiers ? ` · più ${bestQualifiers} migliori successive complessive` : ''}`}</footer>}
          </article>)}</div> : <div className="structure-board final-board">{roundNumbers.map((round) => <section className="structure-round" key={round}><h4>{phase.groupCount > 1 ? `Turno ${round}` : phaseMatches.filter((match) => match.round === round)[0]?.phaseName ?? `Turno ${round}`}</h4><div className="structure-matches">{phaseMatches.filter((match) => match.round === round).map((match) => <article className="structure-match final-match" key={match.id}><span>{phase.groupCount > 1 ? `${match.phaseName} · ` : ''}Partita {match.id.replace('match-', '')}</span><div>{sourceLabel(match.teamAId)}</div><div>{sourceLabel(match.teamBId)}</div></article>)}</div></section>)}</div>}
        </section>
      })}
    </div>
  }

  if (effectiveFormat === 'knockout') {
    const codeById = new Map(previewMatches.map((match, index) => [match.id, alphabeticalLabel(index)]))
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
    <div className="page-heading"><div><span className="eyebrow">Struttura</span><h2>Composizione dei gironi</h2><p>Le squadre assegnate a ciascun girone.</p></div><div className="heading-actions"><button className="button secondary" onClick={onConfigure}><Settings2 size={17} /> Modifica struttura</button><button className="button primary" disabled={!matches.length} onClick={onStart}><Play size={17} /> Avvia torneo</button></div></div>
    <section className="phase-block">
      <header className="phase-heading"><div><span>Fase 1</span><h3>Composizione dei gironi</h3></div><p>{teams.length} squadre</p></header>
      <div className="pools-grid">{pools.map((pool) => <article className="pool-card" key={pool.name}>
        <header><h4>Girone {pool.name.replace(/^\d+/, '')}</h4><span>{pool.teams.length} squadre</span></header>
        <ol>{pool.teams.map((team) => <li key={team}>{team}</li>)}</ol>
        <footer>{phases.length > 1 && groupPhase?.advanceAll ? 'Passano tutte' : 'Classifica finale del girone'}</footer>
      </article>)}</div>
    </section>
  </div>
}

function LivePhaseOverview({ matches, teams, phases, readyCourts, suggestedMatchId, onStart, onEdit }: { matches: Match[]; teams: Team[]; phases: TournamentPhase[]; readyCourts: Map<string, number>; suggestedMatchId?: string; onStart: (match: Match) => void; onEdit: (match: Match) => void }) {
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const currentPhase = phases.find((phase) => matches.some((match) => match.phaseId === phase.id && match.status !== 'completed')) ?? phases.at(-1)
  const phaseMatches = currentPhase ? matches.filter((match) => match.phaseId === currentPhase.id) : []
  const pools = [...new Set(phaseMatches.map((match) => match.pool).filter((pool): pool is string => Boolean(pool)))]
  const sections = pools.length ? pools.map((pool) => ({
    id: pool,
    title: `Girone ${pool.replace(/^\d+/, '')}`,
    matches: phaseMatches.filter((match) => match.pool === pool),
  })) : [...new Set(phaseMatches.map((match) => match.phaseName.split(' · ')[0]))].map((name) => ({ id: name, title: name, matches: phaseMatches.filter((match) => match.phaseName.startsWith(name)) }))

  const matchRow = (match: Match) => {
    const result = getSetWinner(match.sets)
    const readyCourt = readyCourts.get(match.id)
    const suggested = match.id === suggestedMatchId && match.status === 'scheduled'
    return <article className={`phase-match-row ${match.status} ${suggested ? 'suggested' : ''}`} key={match.id}>
      <div><time>{formatMinute(match.startMinute)}</time><small>{match.phaseName}</small></div>
      <span>{participantLabel(match.teamAId, matches, teamById)}</span>
      <b>{match.status === 'completed' ? `${result.a} – ${result.b}` : 'vs'}</b>
      <span>{participantLabel(match.teamBId, matches, teamById)}</span>
      {match.status === 'scheduled' ? <button className={`button ${suggested ? 'primary' : 'secondary'}`} disabled={!readyCourt} onClick={() => onStart(match)}><Play size={13} /> {readyCourt ? `Avvia · C${readyCourt}` : 'In attesa'}</button> : <button className={`button ${match.status === 'playing' ? 'primary' : 'secondary'}`} onClick={() => onEdit(match)}>{match.status === 'playing' ? <><Save size={13} /> Risultato</> : 'Modifica'}</button>}
    </article>
  }

  return <section className="standings-embedded live-phase-overview">
    <div className="page-heading"><div><span className="eyebrow">Fase attuale</span><h2>{currentPhase?.name ?? 'Partite'}</h2><p>Classifiche e partite sono aggiornate insieme. La riga gialla è il prossimo incontro suggerito.</p></div></div>
    <div className="phase-overview-grid">{sections.map((section) => {
      const resolvedMatches = resolveMatchesForStandings(section.matches, matches)
      const ids = new Set(resolvedMatches.flatMap((match) => [match.teamAId, match.teamBId]))
      const standings = currentPhase?.format === 'groups' ? calculateStandings(teams.filter((team) => ids.has(team.id)), resolvedMatches) : []
      return <section className="panel phase-overview-card" key={section.id}>
        <header><div><h3>{section.title}</h3><span>{section.matches.filter((match) => match.status === 'completed').length}/{section.matches.length} giocate</span></div></header>
        {standings.length > 0 && <div className="phase-standings"><table><thead><tr><th>#</th><th>Squadra</th><th>G</th><th>V</th><th>PT</th><th>Set</th><th>Punti</th></tr></thead><tbody>{standings.map((row, index) => <tr key={row.teamId}><td><strong className="rank">{index + 1}</strong></td><td><TeamBadge team={teamById.get(row.teamId)} /></td><td>{row.played}</td><td>{row.won}</td><td><strong>{row.tablePoints}</strong></td><td>{row.setsWon}:{row.setsLost}</td><td>{row.pointsFor}:{row.pointsAgainst}</td></tr>)}</tbody></table></div>}
        <div className="phase-match-list">{section.matches.sort((a, b) => a.startMinute - b.startMinute).map(matchRow)}</div>
      </section>
    })}</div>
  </section>
}

function EmptyState({ icon: Icon, title, action }: { icon: typeof CalendarDays; title: string; action?: () => void }) {
  return <div className="empty-state"><Icon size={34} /><h3>{title}</h3><p>Configura squadre e vincoli nella sezione Progetta.</p>{action && <button className="button dark" onClick={action}><Settings2 size={17} /> Vai alla configurazione</button>}</div>
}
