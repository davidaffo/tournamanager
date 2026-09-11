import type { FormatKind, FormatSuggestion, Match, SetScore, Standing, Team, TournamentConfig, TournamentPhase } from './types'

export const toMinute = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export const formatMinute = (minute: number) => {
  const normalized = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export const estimateMatchMinutes = (config: TournamentConfig) => {
  const sets = Math.max(1, config.setsPerMatch ?? 2)
  const points = Math.max(1, config.pointsPerSet ?? 21)
  const minutesPerPoint = config.tournamentType === 's3' ? 0.65 : 1
  return Math.ceil(sets * points * minutesPerPoint + Math.max(0, sets - 1) * 3)
}

export function parseTeams(input: string): Team[] {
  const seen = new Set<string>()
  return input
    .split(/[\n;,\t]+/)
    .map((name) => name.trim())
    .filter((name) => {
      const key = name.toLocaleLowerCase('it')
      if (!name || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((name, index) => ({ id: `team-${index + 1}`, name, seed: index + 1 }))
}

function roundRobinRounds(ids: string[]): Array<Array<[string, string]>> {
  const participants = [...ids]
  if (participants.length % 2) participants.push('BYE')
  if (participants.length < 2) return []
  const rounds: Array<Array<[string, string]>> = []
  for (let round = 0; round < participants.length - 1; round += 1) {
    const pairings: Array<[string, string]> = []
    for (let i = 0; i < participants.length / 2; i += 1) {
      const a = participants[i]
      const b = participants[participants.length - 1 - i]
      if (a !== 'BYE' && b !== 'BYE') pairings.push(round % 2 ? [b, a] : [a, b])
    }
    rounds.push(pairings)
    participants.splice(1, 0, participants.pop() as string)
  }
  return rounds
}

function splitBalanced<T>(items: T[], count: number): T[][] {
  const groups = Array.from({ length: count }, () => [] as T[])
  items.forEach((item, index) => groups[index % count].push(item))
  return groups
}

function splitTieredSources(items: string[], count: number): string[][] {
  const parsed = items.map((source, index) => ({ source, index, rank: Number(source.match(/^rank:pool-[^:]+:(\d+)$/)?.[1]) }))
  if (parsed.some((item) => !item.rank)) return splitBalanced(items, count)
  const ordered = parsed.sort((a, b) => a.rank - b.rank || a.index - b.index).map((item) => item.source)
  const baseSize = Math.floor(ordered.length / count)
  const largerGroups = ordered.length % count
  let offset = 0
  return Array.from({ length: count }, (_, groupIndex) => {
    const size = baseSize + (groupIndex < largerGroups ? 1 : 0)
    const group = ordered.slice(offset, offset + size)
    offset += size
    return group
  })
}

function splitCrossedSources(items: string[], count: number): string[][] {
  const parsed = items.map((source, index) => ({ source, index, rank: Number(source.match(/^rank:pool-[^:]+:(\d+)$/)?.[1]) }))
  if (parsed.some((item) => !item.rank)) return splitBalanced(items, count)

  const rankBands = new Map<number, Array<{ source: string; index: number }>>()
  parsed.forEach(({ source, index, rank }) => rankBands.set(rank, [...(rankBands.get(rank) ?? []), { source, index }]))
  const groups = Array.from({ length: count }, () => [] as string[])
  ;[...rankBands.entries()].sort(([rankA], [rankB]) => rankA - rankB).forEach(([, band], bandIndex) => {
    band.sort((a, b) => a.index - b.index).forEach(({ source }, sourceIndex) => groups[(sourceIndex + bandIndex) % count].push(source))
  })
  return groups
}

function endEstimate(totalMatches: number, config: TournamentConfig) {
  const slot = estimateMatchMinutes(config)
  const waves = Math.ceil(totalMatches / Math.max(1, config.courts))
  return toMinute(config.startTime) + waves * slot
}

export function getSuggestions(teamCount: number, config: TournamentConfig): FormatSuggestion[] {
  if (teamCount < 2) return []
  const available = Math.max(0, toMinute(config.endTime) - toMinute(config.startTime))
  const capacity = Math.floor(available / estimateMatchMinutes(config)) * config.courts
  const finalSizes = [16, 8, 4, 2, 0].filter((count) => count <= teamCount)
  const plans = Array.from({ length: Math.min(12, Math.max(1, Math.floor(teamCount / 2))) }, (_, index) => index + 1)
    .flatMap((groupCount) => finalSizes.filter((finalTeams) => finalTeams === 0 || finalTeams % groupCount === 0).map((finalTeams) => {
      const sizes = splitBalanced(Array.from({ length: teamCount }), groupCount).map((group) => group.length)
      const poolMatches = sizes.reduce((sum, size) => sum + (size * (size - 1)) / 2, 0)
      const finalMatches = finalTeams > 0 ? finalTeams - 1 + (config.thirdPlaceFinal && finalTeams > 2 ? 1 : 0) : 0
      const totalMatches = poolMatches + finalMatches
      const feasibilityPenalty = totalMatches <= capacity ? 0 : 1000 + (totalMatches - capacity) * 10
      const shapePenalty = Math.abs(teamCount / groupCount - 5) * 8
      const noFinalPenalty = teamCount >= 6 && finalTeams === 0 ? 24 : 0
      const tinyFinalPenalty = teamCount >= 12 && finalTeams === 2 ? 10 : 0
      return { groupCount, finalTeams, sizes, poolMatches, finalMatches, totalMatches, score: feasibilityPenalty + shapePenalty + noFinalPenalty + tinyFinalPenalty }
    }))
    .sort((a, b) => a.score - b.score || b.totalMatches - a.totalMatches)
  const plan = plans[0]
  const { groupCount, finalTeams, sizes, poolMatches, finalMatches: groupFinalMatches } = plan
  const poolMin = Math.max(0, Math.min(...sizes) - 1)
  const poolMax = Math.max(...sizes) - 1
  const knockoutRounds = Math.ceil(Math.log2(teamCount))
  const knockoutMatches = teamCount - 1 + (config.thirdPlaceFinal && teamCount > 2 ? 1 : 0)
  const make = (data: Omit<FormatSuggestion, 'estimatedEnd' | 'utilization' | 'feasible' | 'score' | 'recommended'>): FormatSuggestion => {
    const estimated = endEstimate(data.totalMatches, config)
    const feasible = data.totalMatches <= capacity
    const utilization = capacity ? Math.round((data.totalMatches / capacity) * 100) : 999
    return { ...data, estimatedEnd: formatMinute(estimated), utilization, feasible, score: 0, recommended: false }
  }
  const suggestions = [
    make({
      id: 'groups', name: `${groupCount} gironi${finalTeams ? ` + finale a ${finalTeams}` : ''}`, kicker: 'Gironi + fase finale',
      description: `${Math.min(...sizes)}–${Math.max(...sizes)} squadre per girone. L’algoritmo ha scelto automaticamente ${groupCount} gironi${finalTeams > 0 ? ` e ${finalTeams} qualificate` : ', senza fase finale'}.`,
      totalMatches: poolMatches + groupFinalMatches, gamesMin: poolMin, gamesAverage: ((poolMatches + groupFinalMatches) * 2) / teamCount, gamesMax: poolMax + (finalTeams > 0 ? Math.ceil(Math.log2(finalTeams)) : 0), groupCount, finalTeams,
      phases: [
        { id: 'groups-1', name: 'Fase a gironi', format: 'groups', groupCount, groupComposition: 'strength', advanceAll: false, advancingTeams: finalTeams, thirdPlaceFinal: false },
        ...(finalTeams > 0 ? [{ id: 'finals', name: 'Fase finale', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: config.thirdPlaceFinal }] : []),
      ],
    }),
    make({
      id: 'knockout', name: 'Eliminazione diretta', kicker: 'Chi vince avanza',
      description: `${knockoutRounds} turni fino alla finale${teamCount > 2 ? ', con eventuali passaggi diretti al primo turno' : ''}.`,
      totalMatches: knockoutMatches, gamesMin: Math.max(1, knockoutRounds - 1), gamesAverage: (knockoutMatches * 2) / teamCount, gamesMax: knockoutRounds,
      phases: [{ id: 'knockout', name: 'Eliminazione diretta', format: 'knockout', groupCount: 1, groupComposition: 'strength', advanceAll: false, advancingTeams: 1, thirdPlaceFinal: config.thirdPlaceFinal }],
    }),
  ]
  const feasibleMatches = suggestions.filter((item) => item.feasible).map((item) => item.totalMatches)
  const recommendedMatches = feasibleMatches.length ? Math.max(...feasibleMatches) : Math.min(...suggestions.map((item) => item.totalMatches))
  return suggestions.map((item) => ({ ...item, recommended: item.totalMatches === recommendedMatches }))
}

type DraftMatch = Omit<Match, 'court' | 'startMinute' | 'endMinute' | 'status' | 'sets'>

function generateDrafts(teams: Team[], config: TournamentConfig, kind: FormatKind, phases?: TournamentPhase[]): DraftMatch[] {
  let sequence = 0
  const appendBracket = (drafts: DraftMatch[], initialSources: string[], firstRound: number, phaseId: string, thirdPlaceFinal = config.thirdPlaceFinal) => {
    let sources = initialSources
    let round = firstRound
    let semifinalIds: string[] = []
    while (sources.length > 1) {
      const next: string[] = []
      const roundIds: string[] = []
      for (let index = 0; index < sources.length; index += 2) {
        const id = `match-${++sequence}`
        drafts.push({ id, phaseId, phaseName: sources.length === 2 ? 'Finale' : sources.length === 4 ? 'Semifinale' : 'Eliminazione diretta', round, teamAId: sources[index], teamBId: sources[index + 1] })
        next.push(`winner:${id}`)
        roundIds.push(id)
      }
      if (sources.length === 4) semifinalIds = roundIds
      sources = next
      round += 1
    }
    if (thirdPlaceFinal && semifinalIds.length === 2) {
      drafts.push({ id: `match-${++sequence}`, phaseId, phaseName: 'Finale 3° posto', round: round - 1, teamAId: `loser:${semifinalIds[0]}`, teamBId: `loser:${semifinalIds[1]}` })
    }
  }

  if (phases?.length) {
    const drafts: DraftMatch[] = []
    let sources = teams.map((team) => team.id)
    let firstRound = 1
    phases.forEach((phase, phaseIndex) => {
      if (phase.format === 'groups') {
        const groupCount = Math.min(sources.length, Math.max(1, phase.groupCount))
        const groups = phaseIndex === 0
          ? splitBalanced(sources, groupCount)
          : phase.groupComposition === 'cross'
            ? splitCrossedSources(sources, groupCount)
            : splitTieredSources(sources, groupCount)
        let phaseRounds = 0
        groups.forEach((group, groupIndex) => {
          const pool = `${phaseIndex + 1}${String.fromCharCode(65 + groupIndex)}`
          const rounds = roundRobinRounds(group)
          phaseRounds = Math.max(phaseRounds, rounds.length)
          rounds.forEach((pairings, round) => pairings.forEach(([teamAId, teamBId]) => drafts.push({
            id: `match-${++sequence}`, phaseId: phase.id, phaseName: `${phase.name} · Girone ${String.fromCharCode(65 + groupIndex)}`, pool,
            round: firstRound + round, teamAId, teamBId,
          })))
        })
        if (phaseIndex < phases.length - 1) {
          if (phase.advanceAll) {
            const largestGroup = Math.max(...groups.map((group) => group.length))
            sources = Array.from({ length: largestGroup }, (_, rank) => groups.flatMap((group, groupIndex) => group[rank] ? [`rank:pool-${phaseIndex + 1}${String.fromCharCode(65 + groupIndex)}:${rank + 1}`] : [])).flat()
          } else {
            const advancing = Math.min(sources.length, Math.max(groupCount, phase.advancingTeams))
            const perGroup = Math.max(1, Math.floor(advancing / groupCount))
            sources = Array.from({ length: perGroup }, (_, rank) => groups.map((_, groupIndex) => `rank:pool-${phaseIndex + 1}${String.fromCharCode(65 + groupIndex)}:${rank + 1}`)).flat()
          }
        }
        firstRound += phaseRounds
      } else {
        const bracketSize = 2 ** Math.ceil(Math.log2(sources.length))
        if (bracketSize === sources.length) {
          appendBracket(drafts, sources, firstRound, phase.id, phase.thirdPlaceFinal)
        } else {
          const nextSources: string[] = []
          for (let index = 0; index < bracketSize / 2; index += 1) {
            const teamAId = sources[index]
            const teamBId = sources[bracketSize - index - 1]
            if (teamAId && teamBId) {
              const id = `match-${++sequence}`
              drafts.push({ id, phaseId: phase.id, phaseName: `${phase.name} · Turno preliminare`, round: firstRound, teamAId, teamBId })
              nextSources.push(`winner:${id}`)
            } else if (teamAId || teamBId) nextSources.push(teamAId ?? teamBId)
          }
          appendBracket(drafts, nextSources, firstRound + 1, phase.id, phase.thirdPlaceFinal)
        }
      }
    })
    return drafts
  }

  if (kind === 'groups') {
    const groups = splitBalanced(teams, Math.min(teams.length, Math.max(1, config.groupCount)))
    const drafts = groups.flatMap((group, groupIndex) => {
      const pool = String.fromCharCode(65 + groupIndex)
      return roundRobinRounds(group.map((team) => team.id)).flatMap((pairings, round) => pairings.map(([teamAId, teamBId]) => ({
        id: `match-${++sequence}`, phaseId: `pool-${pool}`, phaseName: `Girone ${pool}`, pool, round: round + 1, teamAId, teamBId,
      })))
    })
    const finalCount = config.finalTeams <= teams.length && config.finalTeams % groups.length === 0 ? config.finalTeams : 0
    if (finalCount > 0) {
      const perPool = finalCount / groups.length
      const qualifiers = Array.from({ length: perPool }, (_, rank) => groups.map((_, groupIndex) => `rank:pool-${String.fromCharCode(65 + groupIndex)}:${rank + 1}`)).flat()
      const firstFinalRound = Math.max(...drafts.map((match) => match.round), 0) + 1
      appendBracket(drafts, qualifiers, firstFinalRound, 'finals')
    }
    return drafts
  }

  const drafts: DraftMatch[] = []
  const bracketSize = 2 ** Math.ceil(Math.log2(teams.length))
  const seededSources = Array.from({ length: bracketSize / 2 }, (_, index) => [teams[index]?.id, teams[bracketSize - index - 1]?.id]).flat().filter(Boolean) as string[]
  if (bracketSize === teams.length) {
    appendBracket(drafts, seededSources, 1, 'knockout')
    return drafts
  }
  let sources: string[] = []
  let round = 1
  for (let index = 0; index < bracketSize / 2; index += 1) {
    const teamAId = teams[index]?.id
    const teamBId = teams[bracketSize - index - 1]?.id
    if (teamAId && teamBId) {
      const id = `match-${++sequence}`
      drafts.push({ id, phaseId: 'knockout', phaseName: bracketSize > teams.length ? 'Turno preliminare' : 'Eliminazione diretta', round, teamAId, teamBId })
      sources.push(`winner:${id}`)
    } else if (teamAId || teamBId) sources.push(teamAId ?? teamBId)
  }
  appendBracket(drafts, sources, round + 1, 'knockout')
  return drafts
}

export function generateMatches(teams: Team[], config: TournamentConfig, kind: FormatKind, phases?: TournamentPhase[]): Match[] {
  const drafts = generateDrafts(teams, config, kind, phases)
  const matchMinutes = estimateMatchMinutes(config)
  const slot = matchMinutes
  const start = toMinute(config.startTime)
  const courtReady = Array.from({ length: config.courts }, () => start)
  const matchReady = new Map<string, number>()
  let activePhaseId: string | undefined
  const participantReady = (source: string) => {
    const dependency = source.match(/^(?:winner|loser):(.+)$/)?.[1]
    if (dependency) return matchReady.get(dependency) ?? start
    if (source.startsWith('rank:pool-')) return Math.max(...matchReady.values(), start)
    return start
  }

  return drafts.map((draft) => {
    if (phases?.length && activePhaseId && activePhaseId !== draft.phaseId) {
      const nextPhaseStart = Math.max(...courtReady) + Math.max(0, config.phaseBreakMinutes ?? 0)
      courtReady.fill(nextPhaseStart)
    }
    activePhaseId = draft.phaseId
    let bestCourt = 0
    let bestStart = Number.POSITIVE_INFINITY
    for (let court = 0; court < config.courts; court += 1) {
      const candidate = Math.max(courtReady[court], participantReady(draft.teamAId), participantReady(draft.teamBId))
      if (candidate < bestStart) {
        bestStart = candidate
        bestCourt = court
      }
    }
    const endMinute = bestStart + matchMinutes
    courtReady[bestCourt] = bestStart + slot
    matchReady.set(draft.id, endMinute)
    return { ...draft, court: bestCourt + 1, startMinute: bestStart, endMinute, status: 'scheduled', sets: [] }
  })
}

function ratio(won: number, lost: number) {
  if (lost === 0) return won > 0 ? Number.POSITIVE_INFINITY : 0
  return won / lost
}

export function getSetWinner(sets: SetScore[]) {
  const a = sets.filter((set) => set.a > set.b).length
  const b = sets.filter((set) => set.b > set.a).length
  return { a, b, winner: a === b ? null : a > b ? 'a' as const : 'b' as const }
}

export function resolveParticipantId(source: string, matches: Match[]): string | undefined {
  const rankReference = source.match(/^rank:pool-([^:]+):(\d+)$/)
  if (rankReference) {
    const poolMatches = matches.filter((match) => match.pool === rankReference[1])
    if (poolMatches.length === 0 || poolMatches.some((match) => match.status !== 'completed')) return undefined
    const ids = [...new Set(poolMatches.flatMap((match) => [match.teamAId, match.teamBId]))]
    const poolTeams = ids.map((id, index) => ({ id, name: id, seed: index + 1 }))
    const rankedSource = calculateStandings(poolTeams, poolMatches)[Number(rankReference[2]) - 1]?.teamId
    return rankedSource ? resolveParticipantId(rankedSource, matches) : undefined
  }
  const reference = source.match(/^(winner|loser):(.+)$/)
  if (!reference) return source
  const match = matches.find((item) => item.id === reference[2])
  if (!match || match.status !== 'completed') return undefined
  const result = getSetWinner(match.sets)
  if (!result.winner) return undefined
  const winnerSource = result.winner === 'a' ? match.teamAId : match.teamBId
  const loserSource = result.winner === 'a' ? match.teamBId : match.teamAId
  return resolveParticipantId(reference[1] === 'winner' ? winnerSource : loserSource, matches)
}

export function calculateStandings(teams: Team[], matches: Match[]): Standing[] {
  const rows = new Map(teams.map((team) => [team.id, {
    teamId: team.id, played: 0, won: 0, lost: 0, tablePoints: 0, setsWon: 0, setsLost: 0,
    pointsFor: 0, pointsAgainst: 0, setRatio: 0, pointRatio: 0,
  }]))
  matches.filter((match) => match.status === 'completed').forEach((match) => {
    const a = rows.get(match.teamAId)
    const b = rows.get(match.teamBId)
    if (!a || !b) return
    const result = getSetWinner(match.sets)
    if (!result.winner) return
    a.played += 1; b.played += 1
    a.setsWon += result.a; a.setsLost += result.b
    b.setsWon += result.b; b.setsLost += result.a
    match.sets.forEach((set) => {
      a.pointsFor += set.a; a.pointsAgainst += set.b
      b.pointsFor += set.b; b.pointsAgainst += set.a
    })
    const winner = result.winner === 'a' ? a : b
    const loser = result.winner === 'a' ? b : a
    winner.won += 1; loser.lost += 1
    const close = Math.min(result.a, result.b) > 0
    winner.tablePoints += close ? 2 : 3
    loser.tablePoints += close ? 1 : 0
  })
  return [...rows.values()].map((row) => ({
    ...row, setRatio: ratio(row.setsWon, row.setsLost), pointRatio: ratio(row.pointsFor, row.pointsAgainst),
  })).sort((a, b) => b.won - a.won || b.tablePoints - a.tablePoints || b.setRatio - a.setRatio || b.pointRatio - a.pointRatio)
}

export function nextReadyMatch(matches: Match[]) {
  return matches
    .filter((match) => match.status === 'scheduled' && resolveParticipantId(match.teamAId, matches) && resolveParticipantId(match.teamBId, matches))
    .sort((a, b) => a.startMinute - b.startMinute)[0]
}
