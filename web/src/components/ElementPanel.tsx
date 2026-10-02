import type { Element } from '../api'

type Props = { element: Element | null | undefined; storeyName?: string }

/** Laid out like a drawing title block: identity first, then property sets as ruled cells. */
export function ElementPanel({ element, storeyName }: Props) {
  if (element === undefined) {
    return <aside className="titleblock empty">Select equipment in the schedule or the model.</aside>
  }
  if (element === null) return <aside className="titleblock empty">No data</aside>
  return (
    <aside className="titleblock" aria-labelledby="el-h">
      <h2 id="el-h">{element.name ?? 'Unnamed'}</h2>
      <dl className="identity">
        <div><dt>Tag</dt><dd className="tag">{element.tag ?? '—'}</dd></div>
        <div><dt>Type</dt><dd>{element.ifc_type}</dd></div>
        <div><dt>Level</dt><dd>{storeyName ?? '—'}</dd></div>
        <div><dt>Material</dt><dd>{element.materials.join(', ') || '—'}</dd></div>
        <div className="wide"><dt>GlobalId</dt><dd className="gid">{element.global_id}</dd></div>
      </dl>
      {Object.entries(element.properties).map(([pset, props]) => (
        <details key={pset} open>
          <summary>{pset}</summary>
          <dl>
            {Object.entries(props).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v === null ? '—' : String(v)}</dd></div>
            ))}
          </dl>
        </details>
      ))}
    </aside>
  )
}
