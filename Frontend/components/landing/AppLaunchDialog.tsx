'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import StoreLinks from './StoreLinks'
import styles from './AppLaunch.module.css'

const announcementKey = 'beautyasist-app-launch-seen-v2'
const openAnnouncement = 'beautyasist:app-launch'
let announcedInPage = false

export function AppLaunchTrigger({
  className,
  children = 'Uygulamayı indir',
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className={className}
      onClick={({ currentTarget }) => {
        window.dispatchEvent(new CustomEvent(openAnnouncement, { detail: currentTarget }))
      }}
    >
      {children}
    </button>
  )
}

export default function AppLaunchDialog() {
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const showFromTrigger = (event: Event) => {
      previousFocusRef.current = (event as CustomEvent<HTMLButtonElement>).detail
      openRef.current = true
      setOpen(true)
    }

    window.addEventListener(openAnnouncement, showFromTrigger)
    return () => window.removeEventListener(openAnnouncement, showFromTrigger)
  }, [])

  useEffect(() => {
    if (announcedInPage) return

    try {
      if (window.sessionStorage.getItem(announcementKey)) return
      window.sessionStorage.setItem(announcementKey, '1')
    } catch {
      // Keep the announcement usable when session storage is unavailable.
    }

    announcedInPage = true
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      previousFocusRef.current = activeElement
    }
    openRef.current = true
    setOpen(true)
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
      openRef.current = next
      setOpen(next)
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            titleRef.current?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(event) => {
            // Radix restores focus asynchronously. A new opening takes priority.
            if (openRef.current) {
              event.preventDefault()
              return
            }
            const previousFocus = previousFocusRef.current
            if (previousFocus?.isConnected) {
              event.preventDefault()
              previousFocus.focus({ preventScroll: true })
            }
          }}
        >
          <Dialog.Close className={styles.close} type="button" aria-label="Duyuruyu kapat">
            <X size={19} strokeWidth={1.6} aria-hidden="true" />
          </Dialog.Close>
          <div className={styles.header}>
            <div className={styles.art} aria-hidden="true">
              <div className={styles.artOrbit} />
              <Image src="/logo.png" width={112} height={112} alt="" unoptimized />
            </div>
            <Dialog.Title className={styles.title} ref={titleRef} tabIndex={-1}>
              BeautyAsist’i <em>cihazınıza indirin.</em>
            </Dialog.Title>
            <Dialog.Description className={styles.description}>
              Mobil ve masaüstü uygulamalarımız yayında.
            </Dialog.Description>
          </div>
          <div className={styles.options}>
            <StoreLinks compact />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
