import { describe, expect, it } from 'vitest'
import { defaultGroupScoring, generateMatches, parseTeams } from './engine/core'
import type { TournamentConfig, TournamentPhase } from './engine/types'
import { buildPublicSnapshot } from './publicSnapshot'

const config: TournamentConfig = {
  name: 'Torneo pubblico', date: '2026-09-20', startTime: '09:00', endTime: '18:00', courts: 2,
  tournamentType: 's3-green', setsPerMatch: 2, pointsPerSet: 15, setPoints: [15, 15], winByTwo: false,
  phaseBreakMinutes: 10, groupCount: 1, finalTeams: 0, thirdPlaceFinal: false,
}
const phases: TournamentPhase[] = [{
  id: 'phase-1', name: 'Gironi', format: 'groups', groupCount: 1, groupComposition: 'strength', groupLegs: 1,
  groupScoring: defaultGroupScoring(), advanceAll: true, advancingTeams: 3, thirdPlaceFinal: false,
}]

describe('public tournament snapshot', () => {
  it('publishes live matches, results and standings but no suggested matches', () => {
    const teams = parseTeams('A\nB\nC')
    const generated = generateMatches(teams, config, 'groups', phases)
    const matches = generated.map((match, index) => index === 0
      ? { ...match, status: 'completed' as const, sets: [{ a: 15, b: 10 }, { a: 15, b: 11 }] }
      : index === 1 ? { ...match, status: 'playing' as const } : match)
    const snapshot = buildPublicSnapshot([{ id: 'one', label: 'Under 12', state: { config, teams, selectedFormat: 'groups', phases, matches } }])

    expect(snapshot.playing).toHaveLength(1)
    expect(snapshot.results).toHaveLength(1)
    expect(snapshot.standings[0].rows.find((row) => row.teamName === 'A')?.tablePoints).toBeDefined()
    expect(snapshot).not.toHaveProperty('suggested')
    expect(snapshot).not.toHaveProperty('upcoming')
  })
})

