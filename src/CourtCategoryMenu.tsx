import { ChevronDown, Settings2 } from 'lucide-react'
import type { TournamentType } from './engine/types'

type Option = { value: TournamentType; label: string }

export function CourtCategoryMenu({ options, allowed, onChange }: { options: Option[]; allowed: TournamentType[]; onChange: (categories: TournamentType[]) => void }) {
  const selected = options.filter((option) => allowed.includes(option.value))
  const allSelected = selected.length === options.length
  const summary = allSelected ? 'Tutte' : selected.map((option) => option.label).join(' · ') || 'Nessuna'
  return <details className="court-category-menu">
    <summary><Settings2 size={13} /><span>Categorie</span><small title={summary}>{summary}</small><ChevronDown size={13} /></summary>
    <div className="court-category-popover">
      <fieldset><legend>Categorie ammesse sul campo</legend>{options.map((option) => <label key={option.value}><input type="checkbox" checked={allowed.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...selected.map((item) => item.value), option.value] : selected.filter((item) => item.value !== option.value).map((item) => item.value))} /><span>{option.label}</span></label>)}</fieldset>
      <footer><button type="button" disabled={allSelected} onClick={() => onChange(options.map((option) => option.value))}>Abilita tutte</button><button type="button" onClick={(event) => { const menu = event.currentTarget.closest('details'); if (menu) menu.open = false }}>Fatto</button></footer>
      {!selected.length && <p>Nessuna categoria abilitata: il campo non può ricevere nuovi incontri.</p>}
    </div>
  </details>
}
