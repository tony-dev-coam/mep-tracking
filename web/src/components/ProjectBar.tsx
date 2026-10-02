import { useState } from 'react'
import type { Project } from '../api'

type Props = {
  projects: Project[]
  projectId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<void>
  onUpload: (file: File) => void
}

export function ProjectBar({ projects, projectId, onSelect, onCreate, onUpload }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await onCreate(name)
      setName('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <header className="bar">
      <h1 className="brand">MEP Tracking</h1>
      <label className="field">
        Project
        <select value={projectId ?? ''} onChange={(e) => onSelect(e.target.value)}>
          {projects.length === 0 && <option value="">No projects yet</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <form className="create" onSubmit={create}>
        <input aria-label="New project" placeholder="New project name" value={name}
          onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()}>Create</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      <label className={`upload${projectId ? '' : ' disabled'}`}>
        Upload IFC
        <input type="file" accept=".ifc" disabled={!projectId}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file)
            e.target.value = ''
          }} />
      </label>
    </header>
  )
}
