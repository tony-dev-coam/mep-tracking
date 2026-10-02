import type { SpatialNode } from '../api'

type Props = { root: SpatialNode | null; onIsolate: (node: SpatialNode) => void }

const ISOLATABLE = new Set(['IfcBuildingStorey', 'IfcSpace'])

export function SpatialTree({ root, onIsolate }: Props) {
  return (
    <section aria-labelledby="tree-h" className="panel">
      <h2 id="tree-h">Spatial structure</h2>
      {root ? <ul className="tree">{renderNode(root, onIsolate)}</ul> : <p className="empty">—</p>}
    </section>
  )
}

function renderNode(node: SpatialNode, onIsolate: Props['onIsolate']) {
  const label = `${node.name ?? node.ifc_type}`
  return (
    <li key={node.global_id}>
      {ISOLATABLE.has(node.ifc_type) ? (
        <button className="node" title="Show only this in 3D" onClick={() => onIsolate(node)}>
          {label} <span className="count">{node.element_count}</span>
        </button>
      ) : (
        <span className="node static">{label}</span>
      )}
      {node.children.length > 0 && <ul>{node.children.map((c) => renderNode(c, onIsolate))}</ul>}
    </li>
  )
}
