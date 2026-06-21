'use client'

import { Building2, Check, ChevronDown, MapPin } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { useBranch } from './BranchContext'

const listVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
}

export default function BranchSwitcher() {
  const pathname = usePathname()
  const { branches, selectedBranch, selectedBranchId, setBranch, selectedInstitution } = useBranch()
  const [open, setOpen] = useState<boolean>(false)

  if (!selectedBranch || pathname?.startsWith('/platform') || pathname?.startsWith('/login')) return null

  return (
    <div className="relative w-full sm:w-auto">
      <motion.button
        whileTap={{ scale: 0.97 }}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group relative flex min-h-12 w-full items-center gap-3 overflow-hidden rounded-[18px] border border-[#ead8df]/90 bg-white/78 px-3 py-2 text-left shadow-[0_14px_34px_-30px_rgba(150,78,104,0.45)] transition-colors hover:border-[#ef9ab5] sm:min-w-[250px]"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-[#ffdce8]/62 via-white/70 to-transparent transition-transform duration-500 group-hover:translate-x-0"
        />
        <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border border-[#efbfd0] bg-[#fff1f6] text-[#c85776]">
          <Building2 className="h-3.5 w-3.5" strokeWidth={1.55} />
        </div>
        <div className="relative z-10 min-w-0 flex-1">
          <div className="text-[10px] font-semibold tracking-tight text-[#9d7386]">Aktif şube</div>
          <div className="truncate text-[12px] font-semibold text-[#352432]">{selectedBranch.name}</div>
          <div className="truncate text-[10px] text-[#7c6170]/72">{selectedInstitution?.name}</div>
        </div>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 text-[#9d7386] group-hover:text-[#c85776]"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.7} />
        </motion.div>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="branch-dropdown"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+10px)] z-50 w-full overflow-hidden rounded-[22px] border border-[#ead8df]/90 bg-white/96 shadow-2xl shadow-[#b86a87]/18 backdrop-blur-xl sm:left-auto sm:right-0 sm:w-[340px]"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[#ffdce8]/80 blur-3xl"
            />
            <div className="relative border-b border-[#ead8df]/75 px-4 py-3">
              <div className="text-[11px] font-semibold tracking-tight text-[#c85776]">Şube kapsamı</div>
              <p className="mt-1 text-[11px] leading-relaxed text-[#7c6170]">
                Randevu, kasa, stok ve personel listeleri seçili şube üzerinden filtrelenir.
              </p>
            </div>
            <motion.div variants={listVariants} initial="hidden" animate="visible" className="relative p-2">
              {branches.map((branch) => {
                const active = branch.id === selectedBranchId
                return (
                  <motion.button
                    key={branch.id}
                    variants={itemVariants}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={() => {
                      setBranch(branch.id)
                      setOpen(false)
                    }}
                    className={`group relative w-full overflow-hidden rounded-[16px] px-3 py-3 text-left transition-colors ${
                      active ? 'bg-[#fff1f6] text-[#352432]' : 'text-[#6a4f5c] hover:bg-[#fff7fa] hover:text-[#352432]'
                    }`}
                  >
                    {!active && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-[#ffdce8]/62 via-white/70 to-transparent transition-transform duration-500 group-hover:translate-x-0"
                      />
                    )}
                    <div className="relative z-10 flex items-start gap-3">
                      <MapPin
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? 'text-[#c85776]' : 'text-[#b56c82]'}`}
                        strokeWidth={1.55}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold">{branch.name}</span>
                          {active && <Check className="h-3.5 w-3.5 shrink-0 text-[#c85776]" />}
                        </div>
                        <div className="mt-1 text-[10px] font-medium text-[#9d7386]">
                          {branch.city} · {branch.staff} personel · {branch.rooms} oda
                        </div>
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
