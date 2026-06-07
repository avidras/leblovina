import * as React from 'react'
import { Dialog } from './dialog'
import { Button } from './button'

export type ConfirmOptions = {
  title?: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  // Tints the confirm button red for irreversible/dangerous actions.
  destructive?: boolean
}

// Promise-based replacement for window.confirm(), styled on the Dialog primitive.
// Usage: const { confirm, confirmElement } = useConfirm(); render {confirmElement};
// then `if (!(await confirm({ message: '…' }))) return`.
export function useConfirm() {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null)
  const resolver = React.useRef<((v: boolean) => void) | null>(null)

  const confirm = React.useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setOpts(options)
    })
  }, [])

  const close = React.useCallback((value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOpts(null)
  }, [])

  const confirmElement = (
    <Dialog
      open={opts != null}
      onClose={() => close(false)}
      title={opts?.title ?? 'Confirm'}
      className="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => close(false)}>
            {opts?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            size="sm"
            className={opts?.destructive ? 'bg-red-600 hover:bg-red-500' : undefined}
            onClick={() => close(true)}
          >
            {opts?.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      }
    >
      <div className="text-sm leading-relaxed text-neutral-700">{opts?.message}</div>
    </Dialog>
  )

  return { confirm, confirmElement }
}
