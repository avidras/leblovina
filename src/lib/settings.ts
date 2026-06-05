import { pb, type GateMode } from './pb'

// The `settings` collection is a key/value store; `extraction_gate` drives the
// UI-controlled decision gate the n8n workflow reads. See specs/club-discovery.md.

export async function getGateMode(): Promise<GateMode> {
  try {
    const rec = await pb.collection('settings').getFirstListItem(`key='extraction_gate'`)
    return (rec.value as GateMode) ?? 'auto_safe'
  } catch {
    return 'auto_safe'
  }
}

export async function setGateMode(mode: GateMode): Promise<void> {
  const rec = await pb.collection('settings').getFirstListItem(`key='extraction_gate'`)
  await pb.collection('settings').update(rec.id, { value: mode })
}
