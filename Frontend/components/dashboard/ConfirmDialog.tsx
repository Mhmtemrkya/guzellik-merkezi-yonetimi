'use client'

import { useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { motion } from 'framer-motion'
import { AlertTriangle, Loader2, X, type LucideIcon } from 'lucide-react'

export interface ConfirmDialogProps {
  trigger: ReactNode
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  icon?: LucideIcon
  onConfirm: () => void | Promise<void>
}

export default function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Onayla',
  cancelLabel = 'Vazgeç',
  destructive = false,
  icon: Icon = AlertTriangle,
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      setOpen(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'İşlem tamamlanamadı.'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!busy) setOpen(next)
        if (!next) setError('')
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-md flex-col overflow-hidden rounded-[26px] border border-[#ead8df]/[0.90] bg-white/[0.96] p-0 text-[#352432] shadow-[0_28px_90px_-48px_rgba(120,71,88,0.62)] backdrop-blur-2xl [&>button:last-child]:hidden">
        <div className="relative bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5] p-6">
          <motion.span
            aria-hidden
            animate={{ opacity: [0.45, 0.75, 0.45] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            className={`pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full blur-3xl ${
              destructive ? 'bg-rose-500/25' : 'bg-[#f0aac2]/[0.22]'
            }`}
          />
          <div className="relative flex items-start gap-4">
            <motion.span
              initial={{ scale: 0.85, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border shadow-[0_14px_34px_-24px_rgba(120,71,88,0.55)] ${
                destructive
                  ? 'border-rose-200/[0.90] bg-rose-50/[0.90] text-rose-700'
                  : 'border-[#efbfd0]/[0.75] bg-white/[0.82] text-[#c85776]'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.6} />
            </motion.span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-display text-2xl tracking-tight">{title}</DialogTitle>
              {description && (
                <DialogDescription className="mt-2 text-[12px] leading-relaxed text-[#352432]/[0.65]">
                  {description}
                </DialogDescription>
              )}
            </div>
            <button
              type="button"
              onClick={() => !busy && setOpen(false)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead8df]/[0.80] bg-white/[0.82] text-[#7e5f6e] shadow-[0_10px_28px_-20px_rgba(120,71,88,0.55)] transition-colors hover:border-[#efbfd0]/[0.90] hover:text-[#352432]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative mt-4 rounded-[16px] border border-rose-200/[0.90] bg-rose-50/[0.88] px-3 py-2 text-[11px] text-rose-700 shadow-[0_14px_34px_-28px_rgba(244,63,94,0.35)]"
            >
              {error}
            </motion.div>
          )}

          <div className="relative mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => !busy && setOpen(false)}
              disabled={busy}
              className="rounded-full border border-[#ead8df]/[0.80] bg-white/[0.72] px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.65] transition-colors hover:border-[#efbfd0]/[0.75] hover:text-[#352432] disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-mono uppercase tracking-widest shadow-[0_12px_28px_-18px_rgba(120,71,88,0.55)] transition-colors disabled:opacity-60 ${
                destructive
                  ? 'border border-rose-200/[0.90] bg-rose-50/[0.95] text-rose-700 hover:bg-rose-100/[0.85]'
                  : 'border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] text-[#2f1724]'
              }`}
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
