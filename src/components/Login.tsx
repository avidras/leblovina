import { useState } from 'react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// The app is public but collection rules are superuser-only, so the SPA logs in.
// (Scoped team users can replace this later — see specs/club-discovery.md.)
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await pb.collection('_superusers').authWithPassword(email, password)
      onSuccess()
    } catch (err) {
      setError((err as Error).message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Leblovina</h1>
        <p className="mt-1 text-sm text-neutral-500">Sign in with your PocketBase admin.</p>
        <div className="mt-4 space-y-3">
          <Input type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <Input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="text-sm text-red-600">{error}</div>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </div>
  )
}
