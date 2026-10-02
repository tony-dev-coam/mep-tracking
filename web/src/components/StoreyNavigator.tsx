import type { SpatialNode } from '../api'

type Props = {
  storeys: SpatialNode[]
  activeId: string | null
  onToggle: (storey: SpatialNode) => void
}

/** Isolate one level at a time without moving the camera (pattern from ifc-viewx's storey navigator). */
export function StoreyNavigator({ storeys, activeId, onToggle }: Props) {
  if (storeys.length === 0) return null
  const index = storeys.findIndex((s) => s.global_id === activeId)
  const step = (delta: number) => onToggle(storeys[index + delta])
  return (
    <section aria-labelledby="storeys-h" className="panel storeys">
      <div className="storeys-head">
        <h2 id="storeys-h">Storeys</h2>
        <span className="stepper">
          <button aria-label="Previous storey" disabled={index <= 0} onClick={() => step(-1)}>▼</button>
          <button aria-label="Next storey" disabled={index < 0 || index >= storeys.length - 1}
            onClick={() => step(1)}>▲</button>
        </span>
      </div>
      <ul>
        {[...storeys].reverse().map((s) => (
          <li key={s.global_id}>
            <button aria-pressed={s.global_id === activeId} onClick={() => onToggle(s)}>
              {s.name ?? 'Storey'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
