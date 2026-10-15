import type { SetScore } from './engine/types'
import { getSetWinner } from './engine/core'

export function MatchSetScores({ sets }: { sets: SetScore[] }) {
  const result = getSetWinner(sets)
  return <span className="match-score"><b aria-label="Set vinti">{result.a}–{result.b}</b><small className="match-set-scores" aria-label="Punteggi dei set">({sets.map((set, index) => <span key={index}>{index > 0 ? ', ' : ''}<span>{set.a}–{set.b}</span></span>)})</small></span>
}
