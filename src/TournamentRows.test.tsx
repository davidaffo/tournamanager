import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TournamentRows } from './TournamentRows'
import { MatchSetScores } from './MatchSetScores'
import { tournamentColor } from './tournamentColors'

describe('simultaneous tournament display', () => {
  it('uses the saved tournament color', () => {
    const html = renderToStaticMarkup(<TournamentRows tournaments={[{ id: 't1', label: 'Red', color: '#ff0000' }]} prefix="live">{() => null}</TournamentRows>)
    expect(html).toContain('--tournament-color:#ff0000')
    expect(tournamentColor(undefined, 0)).not.toBe(tournamentColor(undefined, 1))
    expect(tournamentColor('invalid')).toBe(tournamentColor(undefined))
  })

  it.each([[4, [4]], [5, [4, 1]], [9, [4, 4, 1]]] as const)('shows all %i tournaments in groups of four', (count, sizes) => {
    const tournaments = Array.from({ length: count }, (_, index) => ({ id: `t${index + 1}`, label: `Torneo ${index + 1}` }))
    const html = renderToStaticMarkup(<TournamentRows tournaments={tournaments} prefix="live">{(tournament) => <p>{tournament.label} incontri</p>}</TournamentRows>)
    expect([...html.matchAll(/class="tournament-row columns-(\d)"/g)].map((match) => Number(match[1]))).toEqual([...sizes])
    tournaments.forEach((tournament) => {
      expect(html).toContain(`id="live-${tournament.id}"`)
      expect(html).toContain(`${tournament.label} incontri`)
    })
  })

  it('shows the points of every set, including shortened sets and explicit zeroes', () => {
    const html = renderToStaticMarkup(<MatchSetScores sets={[{ a: 8, b: 6 }, { a: 0, b: 9 }]} />)
    expect(html).toContain('aria-label="Set vinti">1–1</b>')
    expect(html).toContain('<small class="match-set-scores"')
    expect(html.replace(/<[^>]+>/g, '')).toBe('1–1(8–6, 0–9)')
  })
})
