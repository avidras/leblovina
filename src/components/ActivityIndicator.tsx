import { useEffect, useRef, useState } from 'react'
import { pb, type JobRun } from '@/lib/pb'
import { relTime } from '@/lib/time'

// A running job whose heartbeat (`updated`) is older than this is treated as stalled —
// its n8n execution most likely died. See specs/background-jobs.md.
const STALE_MS = 3 * 60 * 1000

type JobView = JobRun & { stalled: boolean }

// Loads the most recent job_runs and keeps them live via PocketBase realtime, so the panel
// updates as workflows heartbeat and survives a page refresh.
function useJobRuns(limit = 25): JobView[] {
  const [map, setMap] = useState<Map<string, JobRun>>(new Map())
  const [, force] = useState(0)

  useEffect(() => {
    let alive = true
    pb.collection('job_runs')
      .getList<JobRun>(1, limit, { sort: '-updated' })
      .then((res) => { if (alive) setMap(new Map(res.items.map((j) => [j.id, j]))) })
      .catch(() => {})
    pb.collection('job_runs')
      .subscribe<JobRun>('*', (e) => {
        setMap((prev) => {
          const next = new Map(prev)
          if (e.action === 'delete') next.delete(e.record.id)
          else next.set(e.record.id, e.record)
          return next
        })
      })
      .catch(() => {})
    // re-evaluate "stalled" on a timer even without new events
    const t = setInterval(() => force((n) => n + 1), 30_000)
    return () => { alive = false; clearInterval(t); pb.collection('job_runs').unsubscribe('*').catch(() => {}) }
  }, [limit])

  const now = Date.now()
  return [...map.values()]
    .map((j) => ({ ...j, stalled: j.status === 'running' && now - new Date(j.updated).getTime() > STALE_MS }))
    .sort((a, b) => {
      // active first, then most-recently-updated
      const ar = a.status === 'running' && !a.stalled ? 0 : 1
      const br = b.status === 'running' && !b.stalled ? 0 : 1
      if (ar !== br) return ar - br
      return new Date(b.updated).getTime() - new Date(a.updated).getTime()
    })
    .slice(0, limit)
}

export function ActivityIndicator() {
  const jobs = useJobRuns()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const active = jobs.filter((j) => j.status === 'running' && !j.stalled)
  const hasActive = active.length > 0

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm font-medium ' +
          (hasActive ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100')
        }
        title="Background activity"
        aria-label="Background activity"
      >
        <span className="relative flex h-2 w-2">
          {hasActive && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />}
          <span className={'relative inline-flex h-2 w-2 rounded-full ' + (hasActive ? 'bg-blue-600' : 'bg-neutral-400')} />
        </span>
        <span className="hidden sm:inline">{hasActive ? `${active.length} running` : 'Activity'}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
          <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Background activity</div>
          {jobs.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-neutral-500">No recent jobs.</div>
          ) : (
            <ul className="max-h-96 space-y-1 overflow-auto">
              {jobs.map((j) => <JobRow key={j.id} job={j} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function JobRow({ job }: { job: JobView }) {
  const state: JobStatusView = job.stalled ? 'stalled' : (job.status || 'running') as JobStatusView
  const pct = job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : null
  return (
    <li className="rounded-md px-2 py-2 hover:bg-neutral-50">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-neutral-800">{job.label || job.kind}</span>
        <StateChip state={state} />
      </div>
      {(job.status === 'running') && (
        <div className="mt-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className={'h-full rounded-full ' + (job.stalled ? 'bg-amber-400' : 'bg-blue-500') + (pct == null && !job.stalled ? ' animate-pulse w-1/3' : '')}
              style={pct != null ? { width: `${pct}%` } : undefined}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-neutral-500">
            <span>{job.total > 0 ? `${job.processed.toLocaleString()} / ${job.total.toLocaleString()}${pct != null ? ` · ${pct}%` : ''}` : `${job.processed.toLocaleString()} processed`}</span>
            <span>{relTime(job.updated)}</span>
          </div>
        </div>
      )}
      {job.status !== 'running' && (
        <div className="mt-0.5 flex justify-between text-[11px] text-neutral-500">
          <span className="truncate">{job.message || (job.total > 0 ? `${job.processed.toLocaleString()} / ${job.total.toLocaleString()}` : '')}</span>
          <span className="whitespace-nowrap">{relTime(job.finished || job.updated)}</span>
        </div>
      )}
    </li>
  )
}

type JobStatusView = 'running' | 'stalled' | 'done' | 'error'
function StateChip({ state }: { state: JobStatusView }) {
  const map: Record<JobStatusView, [string, string]> = {
    running: ['Running', 'bg-blue-100 text-blue-700'],
    stalled: ['Stalled', 'bg-amber-100 text-amber-800'],
    done: ['Done', 'bg-green-100 text-green-700'],
    error: ['Error', 'bg-red-100 text-red-700'],
  }
  const [label, cls] = map[state]
  return <span className={'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ' + cls}>{label}</span>
}
