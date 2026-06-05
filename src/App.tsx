import { useEffect, useState } from 'react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'

export default function App() {
  const [health, setHealth] = useState('checking…')

  useEffect(() => {
    pb.health
      .check()
      .then((r) => setHealth(r.message))
      .catch((e: unknown) => setHealth('unreachable: ' + (e as Error).message))
  }, [])

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Leblovina — Volleyball lead-gen</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Phase 1 · Federations. UI shell — the filterable data table comes next.
        </p>

        <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-sm">
            PocketBase: <span className="font-mono">{health}</span>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => window.location.reload()}>Refresh</Button>
            <Button variant="outline" onClick={() => (window.location.href = '/_/')}>
              Admin
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
