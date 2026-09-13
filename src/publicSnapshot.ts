import { calculateStandings, getSetWinner, resolveMatchesForStandings, resolveParticipantId } from './engine/core'
import type { SetScore, Standing, TournamentState } from './engine/types'

export type PublicMatch = {
  id: string
  tournamentId: string
  tournamentLabel: string
  phaseName: string
  court: number
  startMinute: number
  teamA: string
  teamB: string
  sets: SetScore[]
}

export type PublicStanding = Standing & { teamName: string }
export type PublicStandingSection = { id: string; tournamentId: string; tournamentLabel: string; phaseName: string; title: string; rows: PublicStanding[] }
export type PublicTournament = { id: string; label: string; completed: number; total: number }

export type PublicSnapshot = {
  app: 'tournamanager-live'
  version: 1
  tournamentName: string
  date: string
  updatedAt: string
  tournaments: PublicTournament[]
  playing: PublicMatch[]
  results: PublicMatch[]
  standings: PublicStandingSection[]
}

type PublicWorkspace = { id: string; label: string; state: TournamentState }

const teamName = (source: string, state: TournamentState) => {
  const resolved = resolveParticipantId(source, state.matches)
  return state.teams.find((team) => team.id === resolved)?.name ?? 'Da definire'
}

const publicMatch = (workspace: PublicWorkspace, match: TournamentState['matches'][number]): PublicMatch => ({
  id: `${workspace.id}:${match.id}`,
  tournamentId: workspace.id,
  tournamentLabel: workspace.label,
  phaseName: match.phaseName,
  court: match.court,
  startMinute: match.startMinute,
  teamA: teamName(match.teamAId, workspace.state),
  teamB: teamName(match.teamBId, workspace.state),
  sets: match.sets,
})

export function buildPublicSnapshot(workspaces: PublicWorkspace[]): PublicSnapshot {
  const first = workspaces[0]?.state.config
  const playing: PublicMatch[] = []
  const results: PublicMatch[] = []
  const standings: PublicStandingSection[] = []

  workspaces.forEach((workspace) => {
    const { state } = workspace
    state.matches.forEach((match) => {
      if (match.status === 'playing') playing.push(publicMatch(workspace, match))
      if (match.status === 'completed') results.push(publicMatch(workspace, match))
    })
    const phase = state.phases.find((candidate) => state.matches.some((match) => match.phaseId === candidate.id && match.status !== 'completed')) ?? state.phases.at(-1)
    if (!phase || phase.format !== 'groups') return
    const phaseMatches = state.matches.filter((match) => match.phaseId === phase.id)
    const pools = [...new Set(phaseMatches.map((match) => match.pool).filter((pool): pool is string => Boolean(pool)))]
    pools.forEach((pool) => {
      const poolMatches = phaseMatches.filter((match) => match.pool === pool)
      const resolved = resolveMatchesForStandings(poolMatches, state.matches)
      const ids = new Set(resolved.flatMap((match) => [match.teamAId, match.teamBId]))
      const rows = calculateStandings(state.teams.filter((team) => ids.has(team.id)), resolved)
        .map((row) => ({ ...row, teamName: state.teams.find((team) => team.id === row.teamId)?.name ?? row.teamId }))
      standings.push({ id: `${workspace.id}:${pool}`, tournamentId: workspace.id, tournamentLabel: workspace.label, phaseName: phase.name, title: `Girone ${pool.replace(/^\d+/, '')}`, rows })
    })
  })

  results.sort((a, b) => b.startMinute - a.startMinute)
  playing.sort((a, b) => a.court - b.court || a.startMinute - b.startMinute)
  return {
    app: 'tournamanager-live', version: 1,
    tournamentName: first?.name ?? 'Torneo', date: first?.date ?? '', updatedAt: new Date().toISOString(),
    tournaments: workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.label,
      completed: workspace.state.matches.filter((match) => match.status === 'completed').length,
      total: workspace.state.matches.length,
    })),
    playing,
    results: results.slice(0, 24),
    standings,
  }
}

export const publicSetResult = (sets: SetScore[]) => {
  const result = getSetWinner(sets)
  return `${result.a} – ${result.b}`
}

