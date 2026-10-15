import { estimateMatchMinutes, generateParallelMatches, toMinute, tournamentEndMinute } from './core'
import type { Match, Team, TournamentConfig, TournamentPhase } from './types'

export type BalanceEntry = { id: string; teams: Team[]; config: TournamentConfig; phases: TournamentPhase[] }
export type PointBalanceSuggestion = {
  gapBefore: number
  gapAfter: number
  endMinute: number
  overtimeMinutes: number
  changes: Array<{ tournamentId: string; before: number[]; setPoints: number[]; matchMinutes: number }>
  finishes: Array<{ tournamentId: string; before: number; after: number }>
}

// Evaluate whole shared-court schedules, including simultaneous changes to several tournaments.
export function suggestBalancedSetPoints(entries: BalanceEntry[], baseline?: Record<string, Match[]>): PointBalanceSuggestion | null {
  if (entries.length < 2 || entries.some((entry) => entry.teams.length < 2 || !entry.phases.length)) return null
  const points = entries.map((entry) => Array.from({ length: entry.config.setsPerMatch }, (_, index) => entry.config.setPoints?.[index] ?? entry.config.pointsPerSet))
  const measure = (schedules: Record<string, Match[]>) => {
    const ends = entries.map((entry) => Math.max(toMinute(entry.config.startTime), ...(schedules[entry.id] ?? []).map((match) => match.endMinute)))
    return { gap: Math.max(...ends) - Math.min(...ends), end: Math.max(...ends), ends }
  }
  const schedules = baseline ?? generateParallelMatches(entries)
  const original = measure(schedules)
  if (!original.gap) return null
  const deadline = tournamentEndMinute(entries[0].config.startTime, entries[0].config.endTime)
  const permittedEnd = Math.max(deadline, original.end)
  const configFor = (index: number, setPoints: number[]) => ({ ...entries[index].config, pointsPerSet: setPoints[0], setPoints })
  // Cover the full 1–99 point range; keep the smallest edit for each distinct match duration.
  const options = entries.map((_, index) => {
    const byDuration = new Map<number, { points: number[]; minutes: number; change: number }>()
    for (let delta = 1 - Math.min(...points[index]); delta <= 99 - Math.max(...points[index]); delta += 1) {
      const proposed = points[index].map((value) => value + delta)
      const minutes = estimateMatchMinutes(configFor(index, proposed))
      const change = Math.abs(delta) * proposed.length
      if (!byDuration.has(minutes) || byDuration.get(minutes)!.change > change) byDuration.set(minutes, { points: proposed, minutes, change })
    }
    return [...byDuration.values()]
  })
  const cache = new Map<string, ReturnType<typeof measure>>()
  const evaluate = (targets: number[][]) => {
    const key = targets.map((target, index) => estimateMatchMinutes(configFor(index, target))).join(',')
    let result = cache.get(key)
    if (!result) {
      result = measure(generateParallelMatches(entries.map((entry, index) => ({ ...entry, config: configFor(index, targets[index]) }))))
      cache.set(key, result)
    }
    const change = targets.reduce((total, target, index) => total + target.reduce((sum, value, set) => sum + Math.abs(value - points[index][set]), 0), 0)
    return { ...result, targets, change, exceedsLimit: result.end > permittedEnd }
  }
  type Candidate = ReturnType<typeof evaluate>
  const compare = (a: Candidate, b: Candidate) => Number(a.exceedsLimit) - Number(b.exceedsLimit)
    || a.gap - b.gap || a.change - b.change || Math.abs(a.end - original.end) - Math.abs(b.end - original.end)
  let best: Candidate | null = null
  const consider = (candidate: Candidate) => {
    if (candidate.gap < original.gap && (!best || compare(candidate, best) < 0)) best = candidate
  }
  // Combined seeds cross plateaus where no single-tournament edit is sufficient.
  const counts = entries.map((entry) => schedules[entry.id].length)
  for (const anchor of options[0]) {
    for (const proportional of [false, true]) {
      const targets = options.map((choices, index) => {
        const targetMinutes = proportional ? anchor.minutes * counts[0] / Math.max(1, counts[index]) : anchor.minutes
        return choices.reduce((closest, option) => Math.abs(option.minutes - targetMinutes) < Math.abs(closest.minutes - targetMinutes)
          || (Math.abs(option.minutes - targetMinutes) === Math.abs(closest.minutes - targetMinutes) && option.change < closest.change) ? option : closest).points
      })
      consider(evaluate(targets))
    }
  }
  const improve = (seed: number[][]) => {
    let current = evaluate(seed)
    for (let iteration = 0; iteration < 3; iteration += 1) {
      let next = current
      options.forEach((choices, index) => choices.forEach((option) => {
        const candidate = evaluate(current.targets.map((target, targetIndex) => targetIndex === index ? option.points : target))
        consider(candidate)
        if (compare(candidate, next) < 0) next = candidate
      }))
      if (next === current) break
      current = next
    }
  }
  improve(points)
  if (best) improve((best as Candidate).targets)
  const selected = best as Candidate | null
  if (!selected) return null
  return {
    gapBefore: original.gap, gapAfter: selected.gap, endMinute: selected.end,
    overtimeMinutes: Math.max(0, selected.end - deadline),
    changes: entries.flatMap((entry, index) => selected.targets[index].some((value, set) => value !== points[index][set])
      ? [{ tournamentId: entry.id, before: points[index], setPoints: selected.targets[index], matchMinutes: estimateMatchMinutes(configFor(index, selected.targets[index])) }] : []),
    finishes: entries.map((entry, index) => ({ tournamentId: entry.id, before: original.ends[index], after: selected.ends[index] })),
  }
}
