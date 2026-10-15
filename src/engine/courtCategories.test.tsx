import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CourtCategoryMenu } from '../CourtCategoryMenu'
import { allowedCourts, canStartOnSharedCourts, ensureParallelSchedules, generateMatches, generateParallelMatches, normalizeCourtCategories, parseTeams } from './core'
import type { Match, TournamentConfig, TournamentPhase, TournamentType } from './types'

const config: TournamentConfig = {
  name: 'Campi condivisi', date: '2026-10-15', startTime: '09:00', endTime: '19:00', courts: 2,
  tournamentType: 's3-red', setsPerMatch: 1, pointsPerSet: 15, setPoints: [15], winByTwo: false,
  phaseBreakMinutes: 10, groupCount: 1, finalTeams: 0, thirdPlaceFinal: false,
}
const phases: TournamentPhase[] = [{ id: 'p1', name: 'Girone', format: 'groups', groupCount: 1, groupComposition: 'strength', advanceAll: true, advancingTeams: 4, thirdPlaceFinal: false }]
const entry = (id: string, tournamentType: TournamentType) => ({ id, config: { ...config, tournamentType }, teams: parseTeams('A\nB\nC\nD'), phases })
const verifyNoCourtOverlaps = (matches: Match[]) => matches.forEach((match, index) => matches.slice(index + 1).filter((other) => other.court === match.court && match.court !== 0).forEach((other) => {
  expect(match.endMinute <= other.startMinute || other.endMinute <= match.startMinute).toBe(true)
}))

describe('court category restrictions', () => {
  it('offers only categories present in the tournament in a closed compact menu', () => {
    const html = renderToStaticMarkup(<CourtCategoryMenu options={[{ value: 's3-red', label: 'S3 Red' }]} allowed={['s3-red', 's3-green', 's3-white', '6v6']} onChange={() => {}} />)
    expect(html).toContain('S3 Red')
    expect(html).not.toContain('S3 Green')
    expect(html).not.toContain('S3 White')
    expect(html).not.toContain('6v6')
    expect(html.match(/type="checkbox"/g)).toHaveLength(1)
    expect(html).not.toContain(' open=')
  })

  it('schedules one or several categories only on their allowed shared courts', () => {
    const policy: Record<number, TournamentType[]> = { 1: ['s3-red'], 2: ['s3-green', 's3-white'] }
    const entries = [entry('r', 's3-red'), entry('g', 's3-green'), entry('w', 's3-white')].map((item) => ({ ...item, config: { ...item.config, courtCategories: policy } }))
    const schedules = generateParallelMatches(entries)
    entries.forEach((item) => {
      expect(schedules[item.id]).toHaveLength(6)
      schedules[item.id].forEach((match) => expect(allowedCourts(item.config)).toContain(match.court))
    })
    verifyNoCourtOverlaps(Object.values(schedules).flat())
    expect(new Set(generateMatches(entries[0].teams, entries[0].config, 'groups', phases).map((match) => match.court))).toEqual(new Set([1]))
  })

  it('keeps all blocked encounters without assigning incompatible courts or infinite times', () => {
    const item = entry('r', 's3-red')
    item.config = { ...item.config, courtCategories: { 1: [], 2: ['s3-green'] } }
    const schedules = generateParallelMatches([item])
    expect(schedules.r).toHaveLength(6)
    schedules.r.forEach((match) => {
      expect(match.court).toBe(0)
      expect(Number.isFinite(match.startMinute)).toBe(true)
      expect(Number.isFinite(match.endMinute)).toBe(true)
      expect(canStartOnSharedCourts('r', match, schedules.r, [], item.config)).toBe(false)
    })
    const restored = generateParallelMatches([{ ...item, config: { ...item.config, courtCategories: {} } }])
    expect(restored.r.every((match) => match.court > 0)).toBe(true)
  })

  it('rejects a live start on an incompatible court but accepts an allowed one', () => {
    const item = entry('r', 's3-red')
    const matches = generateParallelMatches([item]).r
    const restricted = { ...item.config, courtCategories: { 1: ['s3-green'] as TournamentType[], 2: ['s3-red'] as TournamentType[] } }
    expect(canStartOnSharedCourts('r', { ...matches[0], court: 1 }, matches, [], restricted)).toBe(false)
    expect(canStartOnSharedCourts('r', { ...matches[0], court: 2 }, matches, [], restricted)).toBe(true)
  })

  it('replans pending games after a live restriction change while preserving scores and ongoing matches', () => {
    const entries = [entry('r', 's3-red'), entry('g', 's3-green')]
    const baseline = generateParallelMatches(entries)
    const completed: Match = { ...baseline.r[0], status: 'completed', sets: [{ a: 8, b: 6 }] }
    const playing: Match = { ...baseline.r[1], status: 'playing' }
    const modified = entries.map((item) => ({ ...item, config: { ...item.config, courtCategories: { 1: ['s3-green'] as TournamentType[], 2: ['s3-red'] as TournamentType[] } }, matches: item.id === 'r' ? [completed, playing, ...baseline.r.slice(2)] : baseline.g }))
    const schedules = ensureParallelSchedules(modified)
    expect(schedules.r.find((match) => match.id === completed.id)).toEqual(completed)
    expect(schedules.r.find((match) => match.id === playing.id)).toEqual(playing)
    modified.forEach((item) => {
      expect(schedules[item.id]).toHaveLength(6)
      schedules[item.id].filter((match) => match.status === 'scheduled').forEach((match) => expect(allowedCourts(item.config)).toContain(match.court))
    })
    verifyNoCourtOverlaps(Object.values(schedules).flat())
  })

  it('preserves valid policies through JSON serialization including a disabled court', () => {
    const policy = normalizeCourtCategories(JSON.parse(JSON.stringify({ 1: ['s3-red', 's3-red', 's3-green'], 2: [], 99: ['s3-white'], invalid: [] })))
    expect(policy).toEqual({ 1: ['s3-red', 's3-green'], 2: [] })
    expect(allowedCourts({ ...config, courtCategories: policy })).toEqual([1])
    expect(allowedCourts({ ...config, courtCategories: policy, tournamentType: 's3-white' })).toEqual([])
  })
})
