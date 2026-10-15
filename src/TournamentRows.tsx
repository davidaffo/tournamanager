import type { ReactNode } from 'react'
import { tournamentTheme } from './tournamentColors'

type Tournament = { id: string; label: string; color?: string }

export function scrollToTournament(prefix: string, id: string) {
  document.getElementById(`${prefix}-${id}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start', inline: 'nearest' })
}

export function TournamentRows({ tournaments, prefix, headerContent, children }: { tournaments: Tournament[]; prefix: string; headerContent?: (tournament: Tournament, index: number) => ReactNode; children: (tournament: Tournament, index: number) => ReactNode }) {
  const groups = Array.from({ length: Math.ceil(tournaments.length / 4) }, (_, index) => tournaments.slice(index * 4, index * 4 + 4))
  return <div className="tournament-rows">{groups.map((group, groupIndex) => <div className={`tournament-row columns-${group.length}`} key={group[0].id}>
    {group.map((tournament, index) => <section className="tournament-column" style={tournamentTheme(tournament.color, groupIndex * 4 + index)} id={`${prefix}-${tournament.id}`} key={tournament.id} aria-label={tournament.label || `Torneo ${groupIndex * 4 + index + 1}`}>
      <header className="tournament-column-heading"><h2>{tournament.label || `Torneo ${groupIndex * 4 + index + 1}`}</h2>{headerContent?.(tournament, groupIndex * 4 + index)}</header>
      {children(tournament, groupIndex * 4 + index)}
    </section>)}
  </div>)}</div>
}
