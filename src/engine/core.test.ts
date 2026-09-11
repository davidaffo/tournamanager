import { describe, expect, it } from 'vitest'
import { alphabeticalLabel, calculateStandings, canStartOnSharedCourts, dependentMatchIds, estimateMatchMinutes, formatMinute, generateMatches, generateParallelMatches, getKnockoutWinner, isValidSetScore, parseTeams, resolveMatchesForStandings, resolveParticipantId, tournamentEndMinute } from './core'
import type { TournamentConfig } from './types'

const config: TournamentConfig = {
  name: 'Test', date: '2026-09-10', startTime: '09:00', endTime: '19:00', courts: 3,
  tournamentType: 's3',
  setsPerMatch: 2, pointsPerSet: 21, setPoints: [21, 21], winByTwo: false, phaseBreakMinutes: 15,
  groupCount: 2, finalTeams: 8, thirdPlaceFinal: true,
}

describe('tournament engine', () => {
  it('imports and deduplicates pasted teams', () => {
    expect(parseTeams('Aurora\nFalchi; aurora\tTigri')).toHaveLength(3)
  })

  it('recognizes a shared club name and keeps it editable in team data', () => {
    const teams = parseTeams('Aurora Blu\nAurora Rossa\nTigri')
    expect(teams.map((team) => team.club)).toEqual(['Aurora', 'Aurora', ''])
  })

  it('separates teams from the same club in the first group stage', () => {
    const teams = parseTeams('Aurora Blu\nAurora Rossa\nTigri Blu\nTigri Rossa')
    const phases = [{ id: 'p1', name: 'Gironi', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: 4, thirdPlaceFinal: false }]
    const matches = generateMatches(teams, config, 'groups', phases)
    for (const pool of ['1A', '1B']) {
      const ids = new Set(matches.filter((match) => match.pool === pool).flatMap((match) => [match.teamAId, match.teamBId]))
      const clubs = teams.filter((team) => ids.has(team.id)).map((team) => team.club)
      expect(new Set(clubs).size).toBe(clubs.length)
    }
  })

  it('estimates match duration from sets and target points', () => {
    expect(estimateMatchMinutes(config)).toBe(31)
    expect(estimateMatchMinutes({ ...config, tournamentType: '6v6' })).toBe(45)
    expect(estimateMatchMinutes({ ...config, setsPerMatch: 3, pointsPerSet: 15, setPoints: [15, 15, 15] })).toBe(36)
    expect(estimateMatchMinutes({ ...config, setsPerMatch: 3, setPoints: [21, 21, 15] })).toBe(44)
    expect(estimateMatchMinutes({ ...config, winByTwo: true })).toBeGreaterThan(estimateMatchMinutes(config))
  })

  it('generates complete round-robin groups', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const matches = generateMatches(teams, { ...config, finalTeams: 0 }, 'groups')
    expect(matches).toHaveLength(12)
    teams.forEach((team) => expect(matches.filter((m) => m.teamAId === team.id || m.teamBId === team.id)).toHaveLength(3))
  })

  it('generates a complete direct-elimination bracket', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const matches = generateMatches(teams, config, 'knockout')
    expect(matches).toHaveLength(8)
    expect(matches.filter((match) => match.phaseName === 'Finale')).toHaveLength(1)
    expect(matches.filter((match) => match.phaseName === 'Finale 3° posto')).toHaveLength(1)
  })

  it('seeds non-power-of-two brackets without making the top seeds play each other after their byes', () => {
    const teams = parseTeams(Array.from({ length: 6 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const matches = generateMatches(teams, config, 'knockout')
    const firstRound = matches.filter((match) => match.round === 1)
    expect(firstRound.map((match) => [match.teamAId, match.teamBId])).toEqual([
      [teams[3].id, teams[4].id],
      [teams[2].id, teams[5].id],
    ])
    const secondRound = matches.filter((match) => match.round === 2)
    expect(secondRound[0].teamAId).toBe(teams[0].id)
    expect(secondRound[1].teamAId).toBe(teams[1].id)
  })

  it('cross-seeds qualifiers from groups in the elimination bracket', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const phases = [
      { id: 'p1', name: 'Gironi', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: 8, thirdPlaceFinal: false },
      { id: 'p2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    ]
    const firstFinalRound = generateMatches(teams, config, 'groups', phases).filter((match) => match.phaseId === 'p2' && match.round === 4)
    expect(firstFinalRound.map((match) => [match.teamAId, match.teamBId])).toEqual([
      ['rank:pool-1A:1', 'rank:pool-1B:4'],
      ['rank:pool-1B:2', 'rank:pool-1A:3'],
      ['rank:pool-1B:1', 'rank:pool-1A:4'],
      ['rank:pool-1A:2', 'rank:pool-1B:3'],
    ])
  })

  it('advances the winner into the next direct-elimination match', () => {
    const teams = parseTeams('A\nB\nC\nD')
    const matches = generateMatches(teams, config, 'knockout')
    const completed = matches.map((match, index) => index === 0 ? { ...match, status: 'completed' as const, sets: [{ a: 25, b: 20 }] } : match)
    const next = completed.find((match) => match.teamAId === `winner:${completed[0].id}` || match.teamBId === `winner:${completed[0].id}`)!
    const source = next.teamAId === `winner:${completed[0].id}` ? next.teamAId : next.teamBId
    expect(resolveParticipantId(source, completed)).toBe(teams[0].id)
  })

  it('finds every downstream result that must be invalidated after an edit', () => {
    const teams = parseTeams('A\nB\nC\nD')
    const matches = generateMatches(teams, config, 'knockout')
    const semifinal = matches.find((match) => match.round === 1)!
    const dependencies = dependentMatchIds(matches, semifinal)
    expect([...dependencies].some((id) => matches.find((match) => match.id === id)?.phaseName === 'Finale')).toBe(true)
  })

  it('adds an elimination phase after complete groups', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const matches = generateMatches(teams, { ...config, finalTeams: 4 }, 'groups')
    expect(matches.filter((match) => match.pool)).toHaveLength(12)
    expect(matches.filter((match) => match.phaseId === 'finals')).toHaveLength(4)
  })

  it('supports a qualifier count not divisible by the number of pools', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const phases = [
      { id: 'p1', name: 'Gironi', format: 'groups' as const, groupCount: 4, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 6, thirdPlaceFinal: false },
      { id: 'p2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    ]
    const matches = generateMatches(teams, config, 'groups', phases)
    const finalSources = matches.filter((match) => match.phaseId === 'p2').flatMap((match) => [match.teamAId, match.teamBId])
    const bestSources = [...new Set(finalSources.filter((source) => source.startsWith('best:phase-1:rank-2:')))]
    expect(bestSources).toHaveLength(2)
    const completedPools = matches.map((match) => match.phaseId === 'p1' ? { ...match, status: 'completed' as const, sets: [{ a: 21, b: 15 }] } : match)
    expect(new Set(bestSources.map((source) => resolveParticipantId(source, completedPools)))).toHaveLength(2)
  })

  it('resolves every qualifier when uneven pools do not all have the requested rank', () => {
    const teams = parseTeams('A\nB\nC\nD\nE')
    const phases = [
      { id: 'p1', name: 'Gironi', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 5, thirdPlaceFinal: false },
      { id: 'p2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    ]
    const matches = generateMatches(teams, config, 'groups', phases).map((match) => match.phaseId === 'p1' ? { ...match, status: 'completed' as const, sets: [{ a: 21, b: 10 }] } : match)
    const references = [...new Set(matches.flatMap((match) => [match.teamAId, match.teamBId]).filter((source) => source.startsWith('rank:') || source.startsWith('best:')))]
    expect(references.every((source) => resolveParticipantId(source, matches))).toBe(true)
  })

  it('resolves the exact requested qualifiers across common uneven formulas', () => {
    for (let teamCount = 4; teamCount <= 20; teamCount += 1) {
      for (let groupCount = 2; groupCount <= Math.floor(teamCount / 2); groupCount += 1) {
        const teams = parseTeams(Array.from({ length: teamCount }, (_, index) => `Team ${index + 1}`).join('\n'))
        for (let advancingTeams = 2; advancingTeams <= teamCount; advancingTeams += 1) {
          const phases = [
            { id: 'p1', name: 'Gironi', format: 'groups' as const, groupCount, groupComposition: 'strength' as const, advanceAll: false, advancingTeams, thirdPlaceFinal: false },
            { id: 'p2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
          ]
          const matches = generateMatches(teams, config, 'groups', phases).map((match) => match.phaseId === 'p1'
            ? { ...match, status: 'completed' as const, sets: [{ a: 21, b: (match.round * 3) % 20 }] }
            : match)
          const references = [...new Set(matches.filter((match) => match.phaseId === 'p2').flatMap((match) => [match.teamAId, match.teamBId]).filter((source) => source.startsWith('rank:') || source.startsWith('best:')))]
          const resolved = references.map((source) => resolveParticipantId(source, matches))
          expect(resolved.every(Boolean), `${teamCount} squadre, ${groupCount} gironi, ${advancingTeams} qualificate`).toBe(true)
          expect(new Set(resolved).size, `${teamCount} squadre, ${groupCount} gironi, ${advancingTeams} qualificate`).toBe(advancingTeams)
        }
      }
    }
  })

  it('places best runners-up away from the winner of their own pool', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, index) => `Team ${index + 1}`).join('\n'))
    const phases = [
      { id: 'p1', name: 'Gironi', format: 'groups' as const, groupCount: 4, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 6, thirdPlaceFinal: false },
      { id: 'p2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    ]
    const losingPoints: Record<string, number> = { '1A': 1, '1B': 2, '1C': 19, '1D': 20 }
    const matches = generateMatches(teams, config, 'groups', phases).map((match) => match.phaseId === 'p1' ? { ...match, status: 'completed' as const, sets: [{ a: 21, b: losingPoints[match.pool as string] }] } : match)
    const poolByTeam = new Map<string, string>()
    matches.filter((match) => match.phaseId === 'p1').forEach((match) => {
      poolByTeam.set(match.teamAId, match.pool as string)
      poolByTeam.set(match.teamBId, match.pool as string)
    })
    const finals = matches.filter((match) => match.phaseId === 'p2')
    const firstRound = Math.min(...finals.map((match) => match.round))
    finals.filter((match) => match.round === firstRound).forEach((match) => {
      const poolA = poolByTeam.get(resolveParticipantId(match.teamAId, matches) as string)
      const poolB = poolByTeam.get(resolveParticipantId(match.teamBId, matches) as string)
      expect(poolA).not.toBe(poolB)
    })
  })

  it.each([3, 5])('does not pair qualifiers from the same pool in the first knockout round with %i pools', (groupCount) => {
    const teams = parseTeams(Array.from({ length: groupCount * 4 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const phases = [
      { id: 'p1', name: 'Gironi', format: 'groups' as const, groupCount, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: teams.length, thirdPlaceFinal: false },
      { id: 'p2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    ]
    const matches = generateMatches(teams, config, 'groups', phases)
    const firstRound = Math.min(...matches.filter((match) => match.phaseId === 'p2').map((match) => match.round))
    matches.filter((match) => match.phaseId === 'p2' && match.round === firstRound).forEach((match) => {
      const poolA = match.teamAId.match(/^rank:pool-([^:]+):/)?.[1]
      const poolB = match.teamBId.match(/^rank:pool-([^:]+):/)?.[1]
      if (poolA && poolB) expect(poolA).not.toBe(poolB)
    })
  })

  it('keeps same-pool qualifiers apart in the first knockout round across common tournament sizes', () => {
    for (let teamCount = 6; teamCount <= 32; teamCount += 1) {
      for (let groupCount = 2; groupCount <= Math.floor(teamCount / 2); groupCount += 1) {
        const teams = parseTeams(Array.from({ length: teamCount }, (_, i) => `Team ${i + 1}`).join('\n'))
        const phases = [
          { id: 'p1', name: 'Gironi', format: 'groups' as const, groupCount, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: teamCount, thirdPlaceFinal: false },
          { id: 'p2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
        ]
        const finals = generateMatches(teams, config, 'groups', phases).filter((match) => match.phaseId === 'p2')
        const firstRound = Math.min(...finals.map((match) => match.round))
        finals.filter((match) => match.round === firstRound).forEach((match) => {
          const poolA = match.teamAId.match(/^rank:pool-([^:]+):/)?.[1]
          const poolB = match.teamBId.match(/^rank:pool-([^:]+):/)?.[1]
          if (poolA && poolB) expect(poolA, `${teamCount} squadre, ${groupCount} gironi`).not.toBe(poolB)
        })
      }
    }
  })

  it('generates a tournament from an editable list of phases', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const phases = [
      { id: 'p1', name: 'Qualificazione', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 4, thirdPlaceFinal: false },
      { id: 'p2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: true },
    ]
    const matches = generateMatches(teams, config, 'groups', phases)
    expect(matches.filter((match) => match.phaseId === 'p1')).toHaveLength(12)
    expect(matches.filter((match) => match.phaseId === 'p2')).toHaveLength(4)
  })

  it('adds a pause only between tournament phases', () => {
    const teams = parseTeams('A\nB\nC\nD')
    const phases = [
      { id: 'p1', name: 'Gironi', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: 4, thirdPlaceFinal: false },
      { id: 'p2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    ]
    const matches = generateMatches(teams, config, 'groups', phases)
    const firstPhaseEnd = Math.max(...matches.filter((match) => match.phaseId === 'p1').map((match) => match.endMinute))
    const secondPhaseStart = Math.min(...matches.filter((match) => match.phaseId === 'p2').map((match) => match.startMinute))
    expect(secondPhaseStart - firstPhaseEnd).toBe(config.phaseBreakMinutes)
  })

  it('does not overlap tournaments sharing the same courts', () => {
    const teamsA = parseTeams('A1\nA2\nA3\nA4')
    const teamsB = parseTeams('B1\nB2\nB3\nB4')
    const firstTournament = generateMatches(teamsA, { ...config, courts: 2 }, 'knockout')
    const secondTournament = generateMatches(teamsB, { ...config, courts: 2 }, 'knockout', undefined, firstTournament)
    secondTournament.forEach((second) => firstTournament.filter((first) => first.court === second.court).forEach((first) => {
      expect(second.endMinute <= first.startMinute || second.startMinute >= first.endMinute).toBe(true)
    }))
  })

  it('never schedules two matches for the same team at the same time, even with excess courts', () => {
    const teams = parseTeams('A\nB\nC\nD\nE')
    const matches = generateMatches(teams, { ...config, courts: 8, groupCount: 1, finalTeams: 0 }, 'groups')
    teams.forEach((team) => {
      const teamMatches = matches.filter((match) => match.teamAId === team.id || match.teamBId === team.id)
      teamMatches.forEach((match, index) => teamMatches.slice(index + 1).forEach((other) => {
        expect(match.endMinute <= other.startMinute || match.startMinute >= other.endMinute).toBe(true)
      }))
    })
  })

  it('blocks live starts when the shared court or a participant is already busy', () => {
    const teams = parseTeams('A\nB\nC\nD')
    const matches = generateMatches(teams, { ...config, courts: 2, groupCount: 1, finalTeams: 0 }, 'groups')
    const active = { ...matches[0], status: 'playing' as const }
    const sameCourt = { ...matches[1], court: active.court }
    const sameTeam = { ...matches.find((match) => match.teamAId === active.teamAId || match.teamBId === active.teamAId)!, court: active.court === 1 ? 2 : 1 }
    const playing = [{ tournamentId: 'a', match: active, matches: [active, ...matches.slice(1)] }]
    expect(canStartOnSharedCourts('b', sameCourt, matches, playing)).toBe(false)
    expect(canStartOnSharedCourts('a', sameTeam, matches, playing)).toBe(false)
  })

  it('does not call a later match before the same team has completed its earlier match', () => {
    const teams = parseTeams('A\nB\nC\nD\nE')
    const matches = generateMatches(teams, { ...config, courts: 8, groupCount: 1, finalTeams: 0 }, 'groups')
    const later = matches.find((match) => matches.some((earlier) => earlier.startMinute < match.startMinute && [earlier.teamAId, earlier.teamBId].some((id) => id === match.teamAId || id === match.teamBId)))!
    expect(canStartOnSharedCourts('a', later, matches, [])).toBe(false)
    const completedEarlier = matches.map((match) => match.startMinute < later.startMinute ? { ...match, status: 'completed' as const, sets: [{ a: 21, b: 10 }] } : match)
    const updatedLater = completedEarlier.find((match) => match.id === later.id)!
    expect(canStartOnSharedCourts('a', updatedLater, completedEarlier, [])).toBe(true)
  })

  it('synchronizes equal phase windows across parallel tournaments', () => {
    const groupPhases = [
      { id: 'a1', name: 'Gironi', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: 4, thirdPlaceFinal: false },
      { id: 'a2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    ]
    const knockoutPhases = [
      { id: 'b1', name: 'Prima fase', format: 'groups' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 2, thirdPlaceFinal: false },
      { id: 'b2', name: 'Finale', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    ]
    const schedules = generateParallelMatches([
      { id: 'a', teams: parseTeams('A1\nA2\nA3\nA4'), config, phases: groupPhases },
      { id: 'b', teams: parseTeams('B1\nB2\nB3\nB4'), config: { ...config, setsPerMatch: 1, pointsPerSet: 15, setPoints: [15] }, phases: knockoutPhases },
    ])
    const all = [...schedules.a, ...schedules.b]
    const firstPhaseEnd = Math.max(...all.filter((match) => match.phaseId === 'a1' || match.phaseId === 'b1').map((match) => match.endMinute))
    const secondPhaseStart = Math.min(...all.filter((match) => match.phaseId === 'a2' || match.phaseId === 'b2').map((match) => match.startMinute))
    expect(secondPhaseStart - firstPhaseEnd).toBe(config.phaseBreakMinutes)
    all.forEach((match, index) => all.slice(index + 1).filter((other) => other.court === match.court).forEach((other) => {
      expect(match.endMinute <= other.startMinute || match.startMinute >= other.endMinute).toBe(true)
    }))
  })

  it('advances every team when pass-all is enabled, including uneven groups', () => {
    const teams = parseTeams(Array.from({ length: 7 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const phases = [
      { id: 'p1', name: 'Gironi', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: 0, thirdPlaceFinal: false },
      { id: 'p2', name: 'Finali', format: 'knockout' as const, groupCount: 1, groupComposition: 'strength' as const, advanceAll: false, advancingTeams: 1, thirdPlaceFinal: false },
    ]
    const finals = generateMatches(teams, config, 'groups', phases).filter((match) => match.phaseId === 'p2')
    const rankSources = new Set(finals.flatMap((match) => [match.teamAId, match.teamBId]).filter((source) => source.startsWith('rank:')))
    expect(finals).toHaveLength(6)
    expect(rankSources).toHaveLength(7)
  })

  it('builds later group stages as strength tiers', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const phases = [
      { id: 'p1', name: 'Prima fase', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: 8, thirdPlaceFinal: false },
      { id: 'p2', name: 'Seconda fase', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: 8, thirdPlaceFinal: false },
    ]
    const secondPhase = generateMatches(teams, config, 'groups', phases).filter((match) => match.phaseId === 'p2')
    const groupA = new Set(secondPhase.filter((match) => match.pool === '2A').flatMap((match) => [match.teamAId, match.teamBId]))
    const groupB = new Set(secondPhase.filter((match) => match.pool === '2B').flatMap((match) => [match.teamAId, match.teamBId]))
    expect(groupA).toEqual(new Set(['rank:pool-1A:1', 'rank:pool-1B:1', 'rank:pool-1A:2', 'rank:pool-1B:2']))
    expect(groupB).toEqual(new Set(['rank:pool-1A:3', 'rank:pool-1B:3', 'rank:pool-1A:4', 'rank:pool-1B:4']))
  })

  it('resolves real team ids for standings in later group stages', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const phases = [
      { id: 'p1', name: 'Prima fase', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: 8, thirdPlaceFinal: false },
      { id: 'p2', name: 'Seconda fase', format: 'groups' as const, groupCount: 2, groupComposition: 'cross' as const, advanceAll: true, advancingTeams: 8, thirdPlaceFinal: false },
    ]
    const matches = generateMatches(teams, config, 'groups', phases).map((match) => match.phaseId === 'p1' ? { ...match, status: 'completed' as const, sets: [{ a: 21, b: 15 }, { a: 21, b: 16 }] } : match)
    const secondPhase = matches.filter((match) => match.phaseId === 'p2')
    const resolved = resolveMatchesForStandings(secondPhase, matches)
    expect(new Set(resolved.flatMap((match) => [match.teamAId, match.teamBId]))).toHaveLength(8)
  })

  it('can cross strong and weak ranking bands in later group stages', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const phases = [
      { id: 'p1', name: 'Prima fase', format: 'groups' as const, groupCount: 2, groupComposition: 'strength' as const, advanceAll: true, advancingTeams: 8, thirdPlaceFinal: false },
      { id: 'p2', name: 'Incroci', format: 'groups' as const, groupCount: 2, groupComposition: 'cross' as const, advanceAll: true, advancingTeams: 8, thirdPlaceFinal: false },
    ]
    const secondPhase = generateMatches(teams, config, 'groups', phases).filter((match) => match.phaseId === 'p2')
    const groupA = new Set(secondPhase.filter((match) => match.pool === '2A').flatMap((match) => [match.teamAId, match.teamBId]))
    const groupB = new Set(secondPhase.filter((match) => match.pool === '2B').flatMap((match) => [match.teamAId, match.teamBId]))
    expect(groupA).toEqual(new Set(['rank:pool-1A:1', 'rank:pool-1B:2', 'rank:pool-1A:3', 'rank:pool-1B:4']))
    expect(groupB).toEqual(new Set(['rank:pool-1B:1', 'rank:pool-1A:2', 'rank:pool-1B:3', 'rank:pool-1A:4']))
  })

  it('uses wins, table points and quotients for rankings', () => {
    const teams = parseTeams('A\nB')
    const [match] = generateMatches(teams, { ...config, groupCount: 1, finalTeams: 0 }, 'groups')
    const standings = calculateStandings(teams, [{ ...match, status: 'completed', sets: [{ a: 25, b: 20 }, { a: 25, b: 22 }] }])
    expect(standings[0].teamId).toBe(teams[0].id)
    expect(standings[0].tablePoints).toBe(3)
    expect(standings[0].setsWon).toBe(2)
  })

  it('records a tied group match instead of silently ignoring it', () => {
    const teams = parseTeams('A\nB')
    const [match] = generateMatches(teams, { ...config, groupCount: 1, finalTeams: 0 }, 'groups')
    const standings = calculateStandings(teams, [{ ...match, status: 'completed', sets: [{ a: 21, b: 15 }, { a: 18, b: 21 }] }])
    expect(standings.map((row) => ({ played: row.played, points: row.tablePoints }))).toEqual([{ played: 1, points: 1 }, { played: 1, points: 1 }])
  })

  it('supports tournament windows that finish after midnight', () => {
    expect(tournamentEndMinute('23:00', '01:00')).toBe(1500)
    expect(formatMinute(1500)).toBe('01:00 (+1g)')
  })

  it('validates fixed-target and two-point-advantage set scores', () => {
    expect(isValidSetScore({ a: 21, b: 20 }, 21, false)).toBe(true)
    expect(isValidSetScore({ a: 22, b: 20 }, 21, false)).toBe(false)
    expect(isValidSetScore({ a: 21, b: 20 }, 21, true)).toBe(false)
    expect(isValidSetScore({ a: 22, b: 20 }, 21, true)).toBe(true)
    expect(isValidSetScore({ a: 25, b: 20 }, 21, true)).toBe(false)
    expect(isValidSetScore({ a: 25, b: 23 }, 21, true)).toBe(true)
  })

  it('always determines a knockout winner after valid tied sets', () => {
    expect(getKnockoutWinner([{ a: 21, b: 10 }, { a: 18, b: 21 }])).toBe('a')
    expect(getKnockoutWinner([{ a: 21, b: 10 }, { a: 10, b: 21 }])).toBe('b')
  })

  it('uses spreadsheet-style labels beyond Z', () => {
    expect(alphabeticalLabel(0)).toBe('A')
    expect(alphabeticalLabel(25)).toBe('Z')
    expect(alphabeticalLabel(26)).toBe('AA')
    expect(alphabeticalLabel(51)).toBe('AZ')
  })
})
