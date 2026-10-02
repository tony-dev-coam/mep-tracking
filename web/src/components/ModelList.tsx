import type { IfcModel } from '../api'

type Props = { models: IfcModel[]; selectedId: string | null; onSelect: (id: string) => void }

export function ModelList({ models, selectedId, onSelect }: Props) {
  return (
    <section aria-labelledby="models-h" className="panel">
      <h2 id="models-h">Model versions</h2>
      {models.length === 0 && <p className="empty">Upload an IFC file to add the first version.</p>}
      <ul className="versions">
        {models.map((m) => (
          <li key={m.id}>
            <button aria-pressed={m.id === selectedId} onClick={() => onSelect(m.id)}>
              <span className="v">v{m.version}</span>
              <span className="file">{m.filename}</span>
              <span role="status" aria-label={`v${m.version} status`} className={`dot ${m.status}`}>
                {m.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
