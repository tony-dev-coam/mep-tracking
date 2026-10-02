import { useMemo, useState } from 'react'
import type { ElementSummary } from '../api'

type Props = {
  equipment: ElementSummary[]
  storeyNames: Record<string, string>
  selectedId: string | null
  onSelect: (e: ElementSummary) => void
}

export function EquipmentSchedule({ equipment, storeyNames, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return equipment
    return equipment.filter((e) =>
      [e.name, e.tag, e.ifc_type, e.storey_global_id && storeyNames[e.storey_global_id]]
        .some((v) => v?.toLowerCase().includes(q)))
  }, [equipment, storeyNames, query])

  return (
    <section aria-labelledby="sched-h" className="schedule">
      <div className="schedule-head">
        <h2 id="sched-h">Equipment schedule</h2>
        <span className="count">{rows.length} of {equipment.length}</span>
      </div>
      <input type="search" aria-label="Search equipment" placeholder="Search tag, name, type, level"
        value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="cols" aria-hidden="true">
        <span>Tag</span><span>Name</span><span>Type</span><span>Level</span>
      </div>
      <ul>
        {rows.map((e) => (
          <li key={e.global_id}>
            <button aria-pressed={e.global_id === selectedId} onClick={() => onSelect(e)}>
              <span className="tag">{e.tag ?? '—'}</span>
              <span>{e.name ?? 'Unnamed'}</span>
              <span>{e.ifc_type.replace(/^Ifc/, '')}</span>
              <span>
                {(e.storey_global_id && storeyNames[e.storey_global_id]) ?? '—'}
                {!e.has_geometry && <em className="badge">no geometry</em>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {equipment.length === 0 && <p className="empty">No equipment in this model.</p>}
    </section>
  )
}
