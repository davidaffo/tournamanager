import type { FormatKind, Match, SetScore, Standing, Team, TournamentConfig, TournamentPhase } from './types'

export const toMinute = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export const formatMinute = (minute: number) => {
  const normalized = ((minute % 1440) + 1440) % 1440
  const day = Math.floor(minute / 1440)
  const time = `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
  return day > 0 ? `${time} (+${day}g)` : time
}

export const tournamentEndMinute = (startTime: string, endTime: string) => {
  const start = toMinute(startTime)
  const end = toMinute(endTime)
  return end <= start ? end + 1440 : end
}

export function alphabeticalLabel(index: number) {
  let value = Math.max(0, Math.floor(index)) + 1
  let label = ''
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }
  return label
}

export const estimateMatchMinutes = (config: TournamentConfig) => {
  const sets = Math.max(1, config.setsPerMatch ?? 2)
  const targets = Array.from({ length: sets }, (_, index) => Math.max(1, config.setPoints?.[index] ?? config.pointsPerSet ?? 21))
  const minutesPerPoint = config.tournamentType === 's3' ? 0.65 : 1
  const advantageFactor = config.winByTwo ? 1.08 : 1
  return Math.ceil(targets.reduce((sum, points) => sum + points * minutesPerPoint * advantageFactor, 0) + Math.max(0, sets - 1) * 3)
}

export function parseTeams(input: string): Team[] {
  const seen = new Set<string>()
  const names = input
    .split(/[\n;,\t]+/)
    .map((name) => name.trim())
    .filter((name) => {
      const key = name.toLocaleLowerCase('it')
      if (!name || seen.has(key)) return false
      seen.add(key)
      return true
    })
  const ignored = new Set(['asd', 'ssd', 'aps', 'volley', 'pallavolo', 'sport', 'sports', 'club', 'team', 'squadra', 'under', 's3', 'blu', 'rossa', 'rosso', 'verde', 'gialla', 'giallo', 'bianca', 'bianco', 'black', 'white', 'red', 'blue'])
  const meaningfulWords = (name: string) => name.split(/[^\p{L}\p{N}]+/u).filter(Boolean).filter((word) => !ignored.has(word.toLocaleLowerCase('it')) && !/^u?\d+$/i.test(word))
  const families = new Map<string, string[][]>()
  names.forEach((name) => {
    const words = meaningfulWords(name)
    const key = words[0]?.toLocaleLowerCase('it')
    if (key) families.set(key, [...(families.get(key) ?? []), words])
  })
  const inferredClubs = new Map<string, string>()
  families.forEach((members, key) => {
    if (members.length < 2) return
    const commonLength = members[0].findIndex((_, index) => members.some((words) => words[index]?.toLocaleLowerCase('it') !== members[0][index].toLocaleLowerCase('it')))
    const length = commonLength === -1 ? Math.min(...members.map((words) => words.length)) : commonLength
    inferredClubs.set(key, members[0].slice(0, Math.max(1, length)).join(' '))
  })
  return names.map((name, index) => {
    const key = meaningfulWords(name)[0]?.toLocaleLowerCase('it')
    return { id: `team-${index + 1}`, name, seed: index + 1, club: key ? inferredClubs.get(key) ?? '' : '' }
  })
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

function rankedSourceData(source: string) {
  const poolRank = source.match(/^rank:pool-([^:]+):(\d+)$/)
  if (poolRank) return { pool: poolRank[1], rank: Number(poolRank[2]) }
  const bestRank = source.match(/^best:phase-(\d+):rank-(\d+):(\d+)$/)
  if (bestRank) return { pool: '', rank: Number(bestRank[2]) }
  return null
}

function splitTeamsByClub(teams: Team[], count: number): Team[][] {
  const clubSizes = new Map<string, number>()
  teams.forEach((team) => {
    const club = team.club.trim().toLocaleLowerCase('it')
    if (club) clubSizes.set(club, (clubSizes.get(club) ?? 0) + 1)
  })
  const ordered = [...teams].sort((a, b) => (clubSizes.get(b.club.trim().toLocaleLowerCase('it')) ?? 0) - (clubSizes.get(a.club.trim().toLocaleLowerCase('it')) ?? 0) || a.seed - b.seed)
  const groups = Array.from({ length: count }, () => [] as Team[])
  ordered.forEach((team) => {
    const club = team.club.trim().toLocaleLowerCase('it')
    const target = groups.map((group, index) => ({
      group,
      index,
      sameClub: club ? group.filter((member) => member.club.trim().toLocaleLowerCase('it') === club).length : 0,
    })).sort((a, b) => a.sameClub - b.sameClub || a.group.length - b.group.length || a.index - b.index)[0]
    target.group.push(team)
  })
  return groups
}

function splitTieredSources(items: string[], count: number): string[][] {
  const parsed = items.map((source, index) => ({ source, index, rank: rankedSourceData(source)?.rank ?? 0 }))
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
  const parsed = items.map((source, index) => ({ source, index, rank: rankedSourceData(source)?.rank ?? 0 }))
  if (parsed.some((item) => !item.rank)) return splitBalanced(items, count)

  const rankBands = new Map<number, Array<{ source: string; index: number }>>()
  parsed.forEach(({ source, index, rank }) => rankBands.set(rank, [...(rankBands.get(rank) ?? []), { source, index }]))
  const groups = Array.from({ length: count }, () => [] as string[])
  ;[...rankBands.entries()].sort(([rankA], [rankB]) => rankA - rankB).forEach(([, band], bandIndex) => {
    band.sort((a, b) => a.index - b.index).forEach(({ source }, sourceIndex) => groups[(sourceIndex + bandIndex) % count].push(source))
  })
  return groups
}

type DraftMatch = Omit<Match, 'court' | 'startMinute' | 'endMinute' | 'status' | 'sets'>

function generateDrafts(teams: Team[], config: TournamentConfig, kind: FormatKind, phases?: TournamentPhase[]): DraftMatch[] {
  let sequence = 0
  const appendBracket = (drafts: DraftMatch[], orderedSources: string[], firstRound: number, phaseId: string, thirdPlaceFinal = config.thirdPlaceFinal, phaseLabel = 'Eliminazione diretta') => {
    const bracketSize = 2 ** Math.ceil(Math.log2(orderedSources.length))
    let seedOrder = [1, 2]
    while (seedOrder.length < bracketSize) {
      const nextSize = seedOrder.length * 2
      seedOrder = seedOrder.flatMap((seed) => [seed, nextSize + 1 - seed])
    }
    let sources: Array<string | undefined> = seedOrder.map((seed) => orderedSources[seed - 1])
    const separationScore = (slots: Array<string | undefined>) => {
      let score = 0
      for (let blockSize = 2; blockSize <= slots.length; blockSize *= 2) {
        const weight = slots.length / blockSize
        for (let start = 0; start < slots.length; start += blockSize) {
          const middle = start + blockSize / 2
          const leftPools = new Set(slots.slice(start, middle).map((source) => source ? rankedSourceData(source)?.pool : '').filter(Boolean))
          const rightPools = new Set(slots.slice(middle, start + blockSize).map((source) => source ? rankedSourceData(source)?.pool : '').filter(Boolean))
          leftPools.forEach((pool) => { if (rightPools.has(pool)) score += weight })
        }
      }
      return score
    }
    let currentScore = separationScore(sources)
    let improved = true
    while (improved) {
      improved = false
      let bestSwap: [number, number] | null = null
      let bestScore = currentScore
      for (let left = 0; left < sources.length; left += 1) {
        const leftData = sources[left] ? rankedSourceData(sources[left] as string) : null
        if (!leftData) continue
        for (let right = left + 1; right < sources.length; right += 1) {
          const rightData = sources[right] ? rankedSourceData(sources[right] as string) : null
          if (!rightData || leftData.rank !== rightData.rank) continue
          const candidate = [...sources]
          ;[candidate[left], candidate[right]] = [candidate[right], candidate[left]]
          const score = separationScore(candidate)
          if (score < bestScore) { bestScore = score; bestSwap = [left, right] }
        }
      }
      if (bestSwap) {
        ;[sources[bestSwap[0]], sources[bestSwap[1]]] = [sources[bestSwap[1]], sources[bestSwap[0]]]
        currentScore = bestScore
        improved = true
      }
    }
    let round = firstRound
    let semifinalIds: string[] = []
    while (sources.length > 1) {
      const next: Array<string | undefined> = []
      const roundIds: string[] = []
      for (let index = 0; index < sources.length; index += 2) {
        const teamAId = sources[index]
        const teamBId = sources[index + 1]
        if (!teamAId || !teamBId) {
          next.push(teamAId ?? teamBId)
          continue
        }
        const id = `match-${++sequence}`
        drafts.push({ id, phaseId, phaseName: sources.length === 2 ? 'Finale' : sources.length === 4 ? 'Semifinale' : round === firstRound && orderedSources.length < bracketSize ? `${phaseLabel} · Turno preliminare` : phaseLabel, round, teamAId, teamBId })
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
          ? splitTeamsByClub(teams, groupCount).map((group) => group.map((team) => team.id))
          : phase.groupComposition === 'cross'
            ? splitCrossedSources(sources, groupCount)
            : splitTieredSources(sources, groupCount)
        let phaseRounds = 0
        groups.forEach((group, groupIndex) => {
          const groupLabel = alphabeticalLabel(groupIndex)
          const pool = `${phaseIndex + 1}${groupLabel}`
          const rounds = roundRobinRounds(group)
          phaseRounds = Math.max(phaseRounds, rounds.length)
          rounds.forEach((pairings, round) => pairings.forEach(([teamAId, teamBId]) => drafts.push({
            id: `match-${++sequence}`, phaseId: phase.id, phaseName: `${phase.name} · Girone ${groupLabel}`, pool,
            round: firstRound + round, teamAId, teamBId,
          })))
        })
        if (phaseIndex < phases.length - 1) {
          if (phase.advanceAll) {
            const largestGroup = Math.max(...groups.map((group) => group.length))
            sources = Array.from({ length: largestGroup }, (_, rank) => groups.flatMap((group, groupIndex) => group[rank] ? [`rank:pool-${phaseIndex + 1}${alphabeticalLabel(groupIndex)}:${rank + 1}`] : [])).flat()
          } else {
            const advancing = Math.min(sources.length, Math.max(1, phase.advancingTeams))
            const perGroup = Math.floor(advancing / groupCount)
            const extra = advancing % groupCount
            sources = [
              ...Array.from({ length: perGroup }, (_, rank) => groups.map((_, groupIndex) => `rank:pool-${phaseIndex + 1}${alphabeticalLabel(groupIndex)}:${rank + 1}`)).flat(),
              ...Array.from({ length: extra }, (_, index) => `best:phase-${phaseIndex + 1}:rank-${perGroup + 1}:${index + 1}`),
            ]
          }
        }
        firstRound += phaseRounds
      } else {
        appendBracket(drafts, sources, firstRound, phase.id, phase.thirdPlaceFinal, phase.name)
      }
    })
    return drafts
  }

  if (kind === 'groups') {
    const groups = splitTeamsByClub(teams, Math.min(teams.length, Math.max(1, config.groupCount)))
    const drafts = groups.flatMap((group, groupIndex) => {
      const pool = alphabeticalLabel(groupIndex)
      return roundRobinRounds(group.map((team) => team.id)).flatMap((pairings, round) => pairings.map(([teamAId, teamBId]) => ({
        id: `match-${++sequence}`, phaseId: `pool-${pool}`, phaseName: `Girone ${pool}`, pool, round: round + 1, teamAId, teamBId,
      })))
    })
    const finalCount = config.finalTeams <= teams.length && config.finalTeams % groups.length === 0 ? config.finalTeams : 0
    if (finalCount > 0) {
      const perPool = finalCount / groups.length
      const qualifiers = Array.from({ length: perPool }, (_, rank) => groups.map((_, groupIndex) => `rank:pool-${alphabeticalLabel(groupIndex)}:${rank + 1}`)).flat()
      const firstFinalRound = Math.max(...drafts.map((match) => match.round), 0) + 1
      appendBracket(drafts, qualifiers, firstFinalRound, 'finals')
    }
    return drafts
  }

  const drafts: DraftMatch[] = []
  appendBracket(drafts, teams.map((team) => team.id), 1, 'knockout')
  return drafts
}

export function generateParallelMatches(entries: Array<{ id: string; teams: Team[]; config: TournamentConfig; phases: TournamentPhase[] }>): Record<string, Match[]> {
  if (!entries.length) return {}
  const result = Object.fromEntries(entries.map((entry) => [entry.id, [] as Match[]])) as Record<string, Match[]>
  const drafts = new Map(entries.map((entry) => [entry.id, generateDrafts(entry.teams, entry.config, entry.phases[0]?.format ?? 'groups', entry.phases)]))
  const courtCount = Math.max(1, entries[0].config.courts)
  const start = toMinute(entries[0].config.startTime)
  const phaseCount = Math.max(...entries.map((entry) => entry.phases.length))
  let phaseStart = start

  for (let phaseIndex = 0; phaseIndex < phaseCount; phaseIndex += 1) {
    const courtReady = Array.from({ length: courtCount }, () => phaseStart)
    const teamReady = new Map<string, number>()
    const matchReady = new Map<string, number>()
    const queues = entries.map((entry) => ({
      entry,
      matches: (drafts.get(entry.id) ?? []).filter((draft) => draft.phaseId === entry.phases[phaseIndex]?.id),
    }))
    let pending = true
    while (pending) {
      pending = false
      queues.forEach(({ entry, matches }) => {
        const draft = matches.shift()
        if (!draft) return
        pending = true
        const duration = estimateMatchMinutes(entry.config)
        const readyFor = (source: string) => {
          const dependency = source.match(/^(?:winner|loser):(.+)$/)?.[1]
          if (dependency) return matchReady.get(`${entry.id}:${dependency}`) ?? phaseStart
          if (source.startsWith('rank:pool-') || source.startsWith('best:phase-')) return phaseStart
          return teamReady.get(`${entry.id}:${source}`) ?? phaseStart
        }
        let bestCourt = 0
        let bestStart = Number.POSITIVE_INFINITY
        for (let court = 0; court < courtCount; court += 1) {
          const candidate = Math.max(courtReady[court], readyFor(draft.teamAId), readyFor(draft.teamBId))
          if (candidate < bestStart) { bestStart = candidate; bestCourt = court }
        }
        const endMinute = bestStart + duration
        courtReady[bestCourt] = endMinute
        teamReady.set(`${entry.id}:${draft.teamAId}`, endMinute)
        teamReady.set(`${entry.id}:${draft.teamBId}`, endMinute)
        matchReady.set(`${entry.id}:${draft.id}`, endMinute)
        result[entry.id].push({ ...draft, court: bestCourt + 1, startMinute: bestStart, endMinute, status: 'scheduled', sets: [] })
      })
    }
    const phaseEnd = Math.max(...courtReady, phaseStart)
    phaseStart = phaseEnd + (phaseIndex < phaseCount - 1 ? Math.max(0, entries[0].config.phaseBreakMinutes) : 0)
  }
  return result
}

export function generateMatches(teams: Team[], config: TournamentConfig, kind: FormatKind, phases?: TournamentPhase[], occupiedMatches: Match[] = []): Match[] {
  const drafts = generateDrafts(teams, config, kind, phases)
  const matchMinutes = estimateMatchMinutes(config)
  const slot = matchMinutes
  const start = toMinute(config.startTime)
  const courtReady = Array.from({ length: config.courts }, () => start)
  const occupiedByCourt = Array.from({ length: config.courts }, (_, court) => occupiedMatches
    .filter((match) => match.court === court + 1)
    .sort((a, b) => a.startMinute - b.startMinute))
  const matchReady = new Map<string, number>()
  const participantReadyAt = new Map<string, number>()
  let activePhaseId: string | undefined
  const participantReady = (source: string) => {
    const dependency = source.match(/^(?:winner|loser):(.+)$/)?.[1]
    if (dependency) return matchReady.get(dependency) ?? start
    return participantReadyAt.get(source) ?? start
  }
  const nextFreeStart = (court: number, requestedStart: number) => {
    let candidate = requestedStart
    for (const occupied of occupiedByCourt[court]) {
      if (candidate + matchMinutes <= occupied.startMinute) break
      if (candidate < occupied.endMinute && candidate + matchMinutes > occupied.startMinute) candidate = occupied.endMinute
    }
    return candidate
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
      const requestedStart = Math.max(courtReady[court], participantReady(draft.teamAId), participantReady(draft.teamBId))
      const candidate = nextFreeStart(court, requestedStart)
      if (candidate < bestStart) {
        bestStart = candidate
        bestCourt = court
      }
    }
    const endMinute = bestStart + matchMinutes
    courtReady[bestCourt] = bestStart + slot
    matchReady.set(draft.id, endMinute)
    participantReadyAt.set(draft.teamAId, endMinute)
    participantReadyAt.set(draft.teamBId, endMinute)
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

export function getKnockoutWinner(sets: SetScore[]) {
  const setResult = getSetWinner(sets)
  if (setResult.winner) return setResult.winner
  const points = sets.reduce((total, set) => ({ a: total.a + set.a, b: total.b + set.b }), { a: 0, b: 0 })
  if (points.a !== points.b) return points.a > points.b ? 'a' as const : 'b' as const
  const lastSet = sets.at(-1)
  if (!lastSet || lastSet.a === lastSet.b) return null
  return lastSet.a > lastSet.b ? 'a' as const : 'b' as const
}

export function isValidSetScore(set: SetScore, target: number, winByTwo: boolean) {
  if (!Number.isInteger(set.a) || !Number.isInteger(set.b) || set.a < 0 || set.b < 0 || set.a === set.b) return false
  const winner = Math.max(set.a, set.b)
  if (!winByTwo) return winner === target
  const loser = Math.min(set.a, set.b)
  return winner === target ? winner - loser >= 2 : loser >= target - 1 && winner - loser === 2
}

export function resolveParticipantId(source: string, matches: Match[]): string | undefined {
  const bestReference = source.match(/^best:phase-(\d+):rank-(\d+):(\d+)$/)
  if (bestReference) {
    const phasePrefix = bestReference[1]
    const rank = Number(bestReference[2])
    const position = Number(bestReference[3])
    const poolNames = [...new Set(matches.map((match) => match.pool).filter((pool): pool is string => typeof pool === 'string' && pool.startsWith(phasePrefix)))]
    const pools = poolNames.map((pool) => {
      const poolMatches = matches.filter((match) => match.pool === pool)
      if (!poolMatches.length || poolMatches.some((match) => match.status !== 'completed')) return null
      const ids = [...new Set(poolMatches.flatMap((match) => [match.teamAId, match.teamBId]))]
      const standings = calculateStandings(ids.map((id, index) => ({ id, name: id, seed: index + 1, club: '' })), poolMatches)
      const row = standings[rank - 1]
      return { pool, row }
    })
    if (!poolNames.length || pools.some((pool) => !pool)) return undefined
    const candidates = pools.flatMap((pool) => pool?.row ? [{ pool: pool.pool, row: pool.row }] : [])
    candidates.sort((a, b) => {
      const aPlayed = Math.max(1, a.row.played)
      const bPlayed = Math.max(1, b.row.played)
      return b.row.won / bPlayed - a.row.won / aPlayed || b.row.tablePoints / bPlayed - a.row.tablePoints / aPlayed || b.row.setRatio - a.row.setRatio || b.row.pointRatio - a.row.pointRatio || a.pool.localeCompare(b.pool)
    })
    const bestPositions = [...new Set(matches.flatMap((match) => [match.teamAId, match.teamBId]).flatMap((candidateSource) => {
      const candidateReference = candidateSource.match(new RegExp(`^best:phase-${phasePrefix}:rank-${rank}:(\\d+)$`))
      return candidateReference ? [Number(candidateReference[1])] : []
    }))].sort((a, b) => a - b)
    const selectedCandidates = candidates.slice(0, Math.max(position, ...bestPositions))
    if (selectedCandidates.length < position) return undefined
    const assignedCandidate = new Map<number, number>()
    const candidateOwner = new Map<number, number>()
    const forbiddenPool = new Map(bestPositions.map((slot) => {
      const slotSource = `best:phase-${phasePrefix}:rank-${rank}:${slot}`
      const holder = matches.find((match) => match.teamAId === slotSource || match.teamBId === slotSource)
      const opponent = holder ? (holder.teamAId === slotSource ? holder.teamBId : holder.teamAId) : ''
      return [slot, rankedSourceData(opponent)?.pool ?? '']
    }))
    const assign = (slot: number, visited: Set<number>): boolean => {
      for (let candidateIndex = 0; candidateIndex < selectedCandidates.length; candidateIndex += 1) {
        if (visited.has(candidateIndex) || selectedCandidates[candidateIndex].pool === forbiddenPool.get(slot)) continue
        visited.add(candidateIndex)
        const owner = candidateOwner.get(candidateIndex)
        if (owner === undefined || assign(owner, visited)) {
          candidateOwner.set(candidateIndex, slot)
          assignedCandidate.set(slot, candidateIndex)
          return true
        }
      }
      return false
    }
    bestPositions.forEach((slot) => assign(slot, new Set()))
    bestPositions.forEach((slot) => {
      if (assignedCandidate.has(slot)) return
      const fallback = selectedCandidates.findIndex((_, index) => !candidateOwner.has(index))
      if (fallback >= 0) { candidateOwner.set(fallback, slot); assignedCandidate.set(slot, fallback) }
    })
    const selected = selectedCandidates[assignedCandidate.get(position) ?? position - 1]?.row.teamId
    return selected ? resolveParticipantId(selected, matches) : undefined
  }
  const rankReference = source.match(/^rank:pool-([^:]+):(\d+)$/)
  if (rankReference) {
    const poolMatches = matches.filter((match) => match.pool === rankReference[1])
    if (poolMatches.length === 0 || poolMatches.some((match) => match.status !== 'completed')) return undefined
    const ids = [...new Set(poolMatches.flatMap((match) => [match.teamAId, match.teamBId]))]
    const poolTeams = ids.map((id, index) => ({ id, name: id, seed: index + 1, club: '' }))
    const rankedSource = calculateStandings(poolTeams, poolMatches)[Number(rankReference[2]) - 1]?.teamId
    return rankedSource ? resolveParticipantId(rankedSource, matches) : undefined
  }
  const reference = source.match(/^(winner|loser):(.+)$/)
  if (!reference) return source
  const match = matches.find((item) => item.id === reference[2])
  if (!match || match.status !== 'completed') return undefined
  const winner = getKnockoutWinner(match.sets)
  if (!winner) return undefined
  const winnerSource = winner === 'a' ? match.teamAId : match.teamBId
  const loserSource = winner === 'a' ? match.teamBId : match.teamAId
  return resolveParticipantId(reference[1] === 'winner' ? winnerSource : loserSource, matches)
}

export function resolveMatchesForStandings(selectedMatches: Match[], allMatches: Match[]) {
  return selectedMatches.flatMap((match) => {
    const teamAId = resolveParticipantId(match.teamAId, allMatches)
    const teamBId = resolveParticipantId(match.teamBId, allMatches)
    return teamAId && teamBId ? [{ ...match, teamAId, teamBId }] : []
  })
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
    a.played += 1; b.played += 1
    const result = getSetWinner(match.sets)
    a.setsWon += result.a; a.setsLost += result.b
    b.setsWon += result.b; b.setsLost += result.a
    match.sets.forEach((set) => {
      a.pointsFor += set.a; a.pointsAgainst += set.b
      b.pointsFor += set.b; b.pointsAgainst += set.a
    })
    if (!result.winner) {
      a.tablePoints += 1
      b.tablePoints += 1
      return
    }
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

export function canStartOnSharedCourts(
  tournamentId: string,
  match: Match,
  matches: Match[],
  playing: Array<{ tournamentId: string; match: Match; matches: Match[] }>,
) {
  if (match.status !== 'scheduled') return false
  const teamA = resolveParticipantId(match.teamAId, matches)
  const teamB = resolveParticipantId(match.teamBId, matches)
  if (!teamA || !teamB) return false
  const hasEarlierPendingMatch = matches.some((other) => {
    if (other.id === match.id || other.status === 'completed' || other.startMinute >= match.startMinute) return false
    const otherA = resolveParticipantId(other.teamAId, matches)
    const otherB = resolveParticipantId(other.teamBId, matches)
    return otherA === teamA || otherA === teamB || otherB === teamA || otherB === teamB
  })
  if (hasEarlierPendingMatch) return false
  return !playing.some((active) => {
    if (active.match.court === match.court) return true
    if (active.tournamentId !== tournamentId) return false
    const activeA = resolveParticipantId(active.match.teamAId, active.matches)
    const activeB = resolveParticipantId(active.match.teamBId, active.matches)
    return activeA === teamA || activeA === teamB || activeB === teamA || activeB === teamB
  })
}

export function dependentMatchIds(matches: Match[], changedMatch: Match) {
  const invalidMatchIds = new Set<string>([changedMatch.id])
  const invalidPools = new Set<string>(changedMatch.pool ? [changedMatch.pool] : [])
  let changed = true
  while (changed) {
    changed = false
    matches.forEach((match) => {
      if (invalidMatchIds.has(match.id)) return
      const dependsOnInvalidResult = [match.teamAId, match.teamBId].some((source) => {
        const dependency = source.match(/^(?:winner|loser):(.+)$/)?.[1]
        if (dependency && invalidMatchIds.has(dependency)) return true
        const pool = source.match(/^rank:pool-([^:]+):\d+$/)?.[1]
        if (pool && invalidPools.has(pool)) return true
        const bestPhase = source.match(/^best:phase-(\d+):rank-\d+:\d+$/)?.[1]
        return Boolean(bestPhase && [...invalidPools].some((invalidPool) => invalidPool.startsWith(bestPhase)))
      })
      if (!dependsOnInvalidResult) return
      invalidMatchIds.add(match.id)
      if (match.pool) invalidPools.add(match.pool)
      changed = true
    })
  }
  invalidMatchIds.delete(changedMatch.id)
  return invalidMatchIds
}
