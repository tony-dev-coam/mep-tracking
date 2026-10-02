import { useEffect, useRef, useState } from 'react'
import { api, type IfcModel } from '../api'
import { Viewer, webgl2Supported } from '../viewer/engine'

type Props = { model: IfcModel | null; onReady: (viewer: Viewer | null) => void }

export function ModelViewer({ model, onReady }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [webgl] = useState(webgl2Supported)
  const ready = webgl && model?.status === 'processed'

  useEffect(() => {
    if (!ready || !model) return
    const viewer = new Viewer(ref.current!)
    let cancelled = false // StrictMode/remount: a late load must not touch a disposed viewer
    setLoadError(null)
    setLoading(true)
    api.file(model.id)
      .then(async (bytes) => {
        if (cancelled) return
        await viewer.load(bytes, model.id)
        if (cancelled) return
        setLoading(false)
        onReady(viewer)
      })
      .catch((e) => {
        if (cancelled) return
        setLoading(false)
        setLoadError(String(e))
      })
    return () => {
      cancelled = true
      onReady(null)
      viewer.dispose()
    }
  }, [ready, model?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  let message: string | null = null
  if (!webgl) message = 'WebGL2 is not available in this browser, so the 3D view cannot be shown.'
  else if (!model) message = 'Choose a processed model version to open it in 3D.'
  else if (model.status === 'processing') message = 'Processing… the model opens here when it is ready.'
  else if (model.status === 'failed') message = `Processing failed: ${model.error}`
  else if (loadError) message = `The model could not be displayed: ${loadError}`
  else if (loading) message = 'Loading model…'

  return (
    <div className="viewer">
      {ready && <div ref={ref} className="canvas" />}
      {message && <p className="viewer-msg">{message}</p>}
    </div>
  )
}
