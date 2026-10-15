import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react'

const normalizeClub = (club: string) => club.normalize('NFKC').trim().toLocaleLowerCase('it')
const ClubColors = createContext(new Map<string, number>())

export function ClubColorsProvider({ clubs, children }: { clubs: string[]; children: ReactNode }) {
  const colors = useMemo(() => {
    const names = [...new Set(clubs.map(normalizeClub).filter(Boolean))].sort()
    return new Map(names.map((name, index) => [name, (index * 137.508 + 210) % 360]))
  }, [clubs])
  return <ClubColors.Provider value={colors}>{children}</ClubColors.Provider>
}

export function TeamName({ name, club = '' }: { name: string; club?: string }) {
  const colors = useContext(ClubColors)
  const tokens = club.match(/[\p{L}\p{N}]+/gu)
  if (!tokens?.length) return <>{name}</>
  const words = [...new Set(tokens)].map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  const matches = [...name.matchAll(pattern)]
  const hue = colors.get(normalizeClub(club)) ?? 210
  let offset = 0
  return <>{matches.map((match) => {
    const start = match.index!
    const before = name.slice(offset, start)
    offset = start + match[0].length
    return <span key={start}>{before}<span className="club-name-text" style={{ '--club-hue': hue } as CSSProperties}>{match[0]}</span></span>
  })}{name.slice(offset)}</>
}
