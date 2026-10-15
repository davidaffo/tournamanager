import { describe, expect, it } from 'vitest'
import { buildConfigurationFile, makeEmptyWorkspaces, readConfigurationFile } from './App'
import { allowedCourts, generateMatches, parseTeams } from './engine/core'
import type { TournamentPhase, TournamentType } from './engine/types'

describe('configuration transfer and fresh tournament', () => {
  it('restores court restrictions, colors and phase options through a real JSON export/import', () => {
    const blank = makeEmptyWorkspaces().tournaments[0]
    const policy: Record<number, TournamentType[]> = { 1: ['s3-red'], 2: ['s3-red', 's3-green'], 3: [] }
    const phases: TournamentPhase[] = [
      { id: 'groups', name: 'Gironi iniziali', format: 'groups', groupCount: 1, groupComposition: 'strength', groupLegs: 2, groupScoring: { mode: 'sets', setWinPoints: 2, winPoints: 3, drawPoints: 1 }, advanceAll: true, advancingTeams: 4, thirdPlaceFinal: false },
      { id: 'finals', name: 'Finali', format: 'knockout', groupCount: 1, groupComposition: 'strength', advanceAll: false, advancingTeams: 1, thirdPlaceFinal: true },
    ]
    const tournaments = (['s3-red', 's3-green'] as const).map((tournamentType, index) => {
      const state = { ...blank.state, config: { ...blank.state.config, name: 'Torneo da esportare', courts: 3, courtCategories: policy, tournamentType }, teams: parseTeams('Aurora Blu\nAurora Rossa\nFenice Blu\nFenice Rossa'), phases }
      return { ...blank, id: `t${index}`, label: `Categoria ${index}`, color: index === 0 ? '#ffffff' : '#2563eb', state: { ...state, matches: generateMatches(state.teams, state.config, 'groups', phases) } }
    })
    const file = buildConfigurationFile(tournaments)
    const restored = readConfigurationFile(JSON.stringify(file))
    expect(restored.tournaments).toHaveLength(2)
    restored.tournaments.forEach((tournament, index) => {
      expect(tournament.state.config.courtCategories).toEqual(policy)
      expect(tournament.color).toBe(tournaments[index].color)
      expect(tournament.state.teams).toEqual(tournaments[index].state.teams)
      expect(tournament.state.phases.map(({ id: _id, ...phase }) => phase)).toEqual(phases.map(({ id: _id, ...phase }) => ({ ...phase, groupLegs: phase.groupLegs ?? 1, groupScoring: phase.groupScoring ?? { mode: 'result', setWinPoints: 1, winPoints: 3, drawPoints: 1 } })))
      expect(file.tournaments[index].state).not.toHaveProperty('matches')
      expect(tournament.state.matches).toEqual([])
    })
    expect(allowedCourts(restored.tournaments[0].state.config)).toEqual([1, 2])
    expect(allowedCourts(restored.tournaments[1].state.config)).toEqual([2])
  })

  it('starts empty even in development and remains empty after saving and loading', () => {
    const empty = makeEmptyWorkspaces()
    const only = empty.tournaments[0]
    expect(empty.tournaments).toHaveLength(1)
    expect(empty.activeId).toBe(only.id)
    expect(only.label).toBe('')
    expect(only.state.config.name).toBe('')
    expect(only.state.config.courtCategories).toEqual({})
    expect(only.state.teams).toEqual([])
    expect(only.state.phases).toEqual([])
    expect(only.state.matches).toEqual([])
    const restored = readConfigurationFile(JSON.stringify(buildConfigurationFile(empty.tournaments)))
    expect(restored.tournaments[0].state.teams).toEqual([])
    expect(restored.tournaments[0].state.phases).toEqual([])
    expect(restored.tournaments[0].state.matches).toEqual([])
    expect(makeEmptyWorkspaces().activeId).not.toBe(empty.activeId)
  })
})
