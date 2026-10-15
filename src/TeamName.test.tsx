import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClubColorsProvider, TeamName } from './TeamName'

describe('society text colors', () => {
  it('colors only the society words and leaves the complete team name intact', () => {
    const html = renderToStaticMarkup(<TeamName name="Aurora Blu" club="Aurora" />)
    expect(html).toContain('>Aurora</span>')
    expect(html).not.toContain('>Aurora Blu</span>')
    expect(html.replace(/<[^>]+>/g, '')).toBe('Aurora Blu')
    expect(html).not.toContain('<i>')
  })

  it('gives the same society one color across teams and different societies distinct colors', () => {
    const html = renderToStaticMarkup(<ClubColorsProvider clubs={['Aurora', ' AURORA ', 'Fenice']}>
      <TeamName name="Aurora Blu" club="Aurora" />
      <TeamName name="AURORA Rossa" club=" AURORA " />
      <TeamName name="Fenice Blu" club="Fenice" />
    </ClubColorsProvider>)
    const colors = [...html.matchAll(/class="club-name-text" style="([^"]+)"/g)].map((match) => match[1])
    expect(colors).toHaveLength(3)
    expect(colors[0]).toBe(colors[1])
    expect(colors[0]).not.toBe(colors[2])
  })

  it('matches multiple society words without changing capitalization or spacing', () => {
    const html = renderToStaticMarkup(<TeamName name="Volley Città  Blu" club="ASD Volley Città" />)
    expect(html.match(/class="club-name-text"/g)).toHaveLength(2)
    expect(html.replace(/<[^>]+>/g, '')).toBe('Volley Città  Blu')
  })

  it('adds no labels or colors to missing societies or unrelated team names', () => {
    expect(renderToStaticMarkup(<TeamName name="Squadra Blu" />)).toBe('Squadra Blu')
    expect(renderToStaticMarkup(<TeamName name="Irisa Blu" club="Iris" />)).toBe('Irisa Blu')
  })
})
