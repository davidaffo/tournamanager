import type { CSSProperties } from 'react'

export const tournamentPalette = [
  { name: 'Blu', color: '#2563eb' },
  { name: 'Viola', color: '#7c3aed' },
  { name: 'Verde', color: '#16a34a' },
  { name: 'Arancione', color: '#ea580c' },
  { name: 'Fucsia', color: '#db2777' },
  { name: 'Giallo', color: '#eab308' },
  { name: 'Rosso', color: '#dc2626' },
  { name: 'Turchese', color: '#0891b2' },
  { name: 'Bianco', color: '#ffffff' },
]
const defaultColors = tournamentPalette.map((entry) => entry.color)
const previousPalette = ['#6b8799', '#90809c', '#688c80', '#ac896b', '#a17d8d', '#8b946a', '#af7e70', '#7c8890']

export function tournamentColor(value: unknown, index = 0): string {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) return defaultColors[index % defaultColors.length]
  const normalized = value.toLowerCase()
  const previousIndex = previousPalette.indexOf(normalized)
  return previousIndex >= 0 ? defaultColors[previousIndex] : normalized
}

export function tournamentTheme(value: unknown, index = 0): CSSProperties {
  const color = tournamentColor(value, index)
  return { '--tournament-color': color } as CSSProperties
}
