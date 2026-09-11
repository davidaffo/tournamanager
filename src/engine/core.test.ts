import { describe, expect, it } from 'vitest'
import { calculateStandings, estimateMatchMinutes, generateMatches, getSuggestions, parseTeams, resolveParticipantId } from './core'
import type { TournamentConfig } from './types'

const config: TournamentConfig = {
  name: 'Test', date: '2026-09-10', startTime: '09:00', endTime: '19:00', courts: 3,
  tournamentType: 's3',
  setsPerMatch: 2, pointsPerSet: 21, phaseBreakMinutes: 15,
  groupCount: 2, finalTeams: 8, thirdPlaceFinal: true,
}

describe('tournament engine', () => {
  it('imports and deduplicates pasted teams', () => {
    expect(parseTeams('Aurora\nFalchi; aurora\tTigri')).toHaveLength(3)
  })

  it('estimates match duration from sets and target points', () => {
    expect(estimateMatchMinutes(config)).toBe(31)
    expect(estimateMatchMinutes({ ...config, tournamentType: '6v6' })).toBe(45)
    expect(estimateMatchMinutes({ ...config, setsPerMatch: 3, pointsPerSet: 15 })).toBe(36)
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

  it('advances the winner into the next direct-elimination match', () => {
    const teams = parseTeams('A\nB\nC\nD')
    const matches = generateMatches(teams, config, 'knockout')
    const completed = matches.map((match, index) => index === 0 ? { ...match, status: 'completed' as const, sets: [{ a: 25, b: 20 }] } : match)
    const next = completed.find((match) => match.teamAId === `winner:${completed[0].id}` || match.teamBId === `winner:${completed[0].id}`)!
    const source = next.teamAId === `winner:${completed[0].id}` ? next.teamAId : next.teamBId
    expect(resolveParticipantId(source, completed)).toBe(teams[0].id)
  })

  it('adds an elimination phase after complete groups', () => {
    const teams = parseTeams(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`).join('\n'))
    const matches = generateMatches(teams, { ...config, finalTeams: 4 }, 'groups')
    expect(matches.filter((match) => match.pool)).toHaveLength(12)
    expect(matches.filter((match) => match.phaseId === 'finals')).toHaveLength(4)
  })

  it('marks impossible suggestions as not feasible', () => {
    const suggestions = getSuggestions(24, { ...config, endTime: '10:00', courts: 1 })
    expect(suggestions.every((suggestion) => !suggestion.feasible)).toBe(true)
  })

  it('chooses groups and qualifiers without requiring them in the global settings', () => {
    const [suggestion] = getSuggestions(24, { ...config, groupCount: 99, finalTeams: 0 })
    expect(suggestion.groupCount).toBeLessThan(12)
    expect(suggestion.phases[0].groupCount).toBe(suggestion.groupCount)
    expect(suggestion.phases[0].advancingTeams).toBe(suggestion.finalTeams)
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
})
