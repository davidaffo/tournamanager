import { describe, expect, it } from 'vitest'
import { generateParallelMatches, parseTeams } from './core'
import { suggestBalancedSetPoints } from './pointSuggestions'
import type { TournamentConfig, TournamentPhase } from './types'
import { demoTournamentTeamNames } from './demo'

const config: TournamentConfig = {
  name: 'Test', date: '2026-10-15', startTime: '09:00', endTime: '19:00', courts: 4,
  tournamentType: 's3-green', setsPerMatch: 1, pointsPerSet: 15, setPoints: [15],
  winByTwo: false, phaseBreakMinutes: 15, groupCount: 1, finalTeams: 0, thirdPlaceFinal: false,
}
const phases: TournamentPhase[] = [{ id: 'p1', name: 'Gironi', format: 'groups', groupCount: 1, groupComposition: 'strength', advanceAll: true, advancingTeams: 4, thirdPlaceFinal: false }]
const entry = (id: string, points: number[]) => ({ id, teams: parseTeams('A\nB\nC\nD'), config: { ...config, setsPerMatch: points.length, pointsPerSet: points[0], setPoints: points }, phases })

describe('set point suggestions', () => {
  it('reduces the actual shared-court finish gap and reports the recalculated result', () => {
    const entries = [entry('a', [8]), entry('b', [15])]
    const suggestion = suggestBalancedSetPoints(entries)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.gapAfter).toBeLessThan(suggestion!.gapBefore)
    const schedules = generateParallelMatches(entries.map((item) => {
      const change = suggestion!.changes.find((candidate) => candidate.tournamentId === item.id)
      return change ? { ...item, config: { ...item.config, setPoints: change.setPoints, pointsPerSet: change.setPoints[0] } } : item
    }))
    const ends = Object.values(schedules).map((matches) => Math.max(...matches.map((match) => match.endMinute)))
    expect(suggestion!.gapAfter).toBe(Math.max(...ends) - Math.min(...ends))
    expect(suggestion!.endMinute).toBe(Math.max(...ends))
  })

  it('does not suggest changes for a single tournament or already equal finishes', () => {
    expect(suggestBalancedSetPoints([entry('a', [15])])).toBeNull()
    expect(suggestBalancedSetPoints([entry('a', [15]), entry('b', [15])])).toBeNull()
  })

  it('preserves set count and shorter deciding sets', () => {
    const suggestion = suggestBalancedSetPoints([entry('a', [15, 8]), entry('b', [21, 14])])
    expect(suggestion).not.toBeNull()
    suggestion!.changes.forEach((change) => {
      expect(change.setPoints).toHaveLength(2)
      expect(change.setPoints[0] - change.setPoints[1]).toBe(7)
    })
  })

  it('accounts for all three tournaments and never worsens an existing deadline overrun', () => {
    const entries = [entry('a', [8]), entry('b', [15]), entry('c', [12])].map((item) => ({ ...item, config: { ...item.config, endTime: '09:05' } }))
    const baseline = generateParallelMatches(entries)
    const originalEnd = Math.max(...Object.values(baseline).flat().map((match) => match.endMinute))
    const suggestion = suggestBalancedSetPoints(entries, baseline)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.gapAfter).toBeLessThan(suggestion!.gapBefore)
    expect(suggestion!.endMinute).toBeLessThanOrEqual(originalEnd)
    expect(suggestion!.finishes).toHaveLength(3)
  })

  it('finds coordinated changes beyond the old eight-point limit', () => {
    const entries = [entry('a', [8]), entry('b', [40]), entry('c', [24])].map((item) => ({ ...item, config: { ...item.config, courts: 6 } }))
    const suggestion = suggestBalancedSetPoints(entries)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.gapAfter).toBe(0)
    expect(suggestion!.changes.length).toBeGreaterThanOrEqual(2)
    expect(suggestion!.changes.some((change) => Math.abs(change.setPoints[0] - change.before[0]) > 8)).toBe(true)
  })

  it('reduces a 23-minute gap with only two shared courts', () => {
    const entries = [entry('a', [15]), entry('b', [35])].map((item) => ({ ...item, config: { ...item.config, courts: 2 } }))
    const suggestion = suggestBalancedSetPoints(entries)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.gapBefore).toBe(23)
    expect(suggestion!.gapAfter).toBeLessThan(suggestion!.gapBefore)
    expect(suggestion!.changes.length).toBeGreaterThan(0)
  })

  it('balances the three demo tournaments with different categories and team counts', () => {
    const entries = demoTournamentTeamNames.map((names, index) => ({
      id: `demo-${index}`, teams: parseTeams(names.join('\n')),
      config: { ...config, tournamentType: (['s3-red', 's3-green', 's3-white'] as const)[index], setPoints: [index === 2 ? 8 : 15] },
      phases: [{ ...phases[0], groupCount: names.length / 4, advancingTeams: names.length }],
    }))
    const suggestion = suggestBalancedSetPoints(entries)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.gapAfter).toBeLessThan(suggestion!.gapBefore)
    const adjusted = entries.map((item) => {
      const change = suggestion!.changes.find((candidate) => candidate.tournamentId === item.id)
      return change ? { ...item, config: { ...item.config, pointsPerSet: change.setPoints[0], setPoints: change.setPoints } } : item
    })
    const schedules = generateParallelMatches(adjusted)
    suggestion!.finishes.forEach((finish) => expect(finish.after).toBe(Math.max(...schedules[finish.tournamentId].map((match) => match.endMinute))))
  }, 30000)
})
