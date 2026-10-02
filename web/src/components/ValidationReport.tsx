import type { IfcModel } from '../api'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function ValidationReport({ model }: { model: IfcModel }) {
  if (!model.validation) return null
  const { summary, checks } = model.validation
  return (
    <section aria-label="Validation" className="panel">
      <h2>Validation</h2>
      <p className="summary">
        <span className="sev-PASS">{summary.pass} passed</span>
        <span className="sev-WARNING">{plural(summary.warning, 'warning')}</span>
        <span className="sev-ERROR">{plural(summary.error, 'error')}</span>
      </p>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.code} className={`sev-${c.severity}`}>
            <span className="mark" aria-label={c.severity.toLowerCase()}>
              {c.severity === 'PASS' ? '✓' : c.severity === 'WARNING' ? '!' : '✕'}
            </span>
            {c.message}
          </li>
        ))}
      </ul>
    </section>
  )
}
