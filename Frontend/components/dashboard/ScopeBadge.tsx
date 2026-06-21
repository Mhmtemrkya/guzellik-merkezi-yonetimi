'use client'

import { motion } from 'framer-motion'
import { Filter, X } from 'lucide-react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface ScopeBadgeProps {
  label: string
  description?: string
}

/**
 * ScopeBadge — shows the active sidebar sub-filter (?scope=...) at top of page
 * with an X to clear it (returns to default ?scope=all behaviour).
 */
export default function ScopeBadge({ label, description }: ScopeBadgeProps) {
  const router = useRouter()
  const pathname = usePathname() || ''
  const search = useSearchParams()
  const scope = search?.get('scope')
  if (!scope || scope === 'all') return null

  const clear = (): void => {
    router.push(pathname)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative inline-flex items-center gap-3 overflow-hidden border border-[#efbfd0]/75 bg-gradient-to-r from-[#f0aac2]/15 via-[#fff4f8]/[0.04] to-transparent px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776] backdrop-blur-md"
    >
      <Filter className="h-3 w-3" />
      <span className="text-[#352432]/85">{label}</span>
      {description && <span className="hidden text-[#352432]/45 sm:inline">· {description}</span>}
      <button
        type="button"
        onClick={clear}
        aria-label="Filtreyi kaldır"
        className="ml-1 grid h-5 w-5 place-items-center text-[#352432]/45 transition-colors hover:text-[#c85776]"
      >
        <X className="h-3 w-3" strokeWidth={2} />
      </button>
    </motion.div>
  )
}
