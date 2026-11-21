'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Play, X } from 'lucide-react'
import styles from '@/app/home.module.css'

export default function LandingFilm() {
  return (
    <Dialog.Root>
      <Dialog.Trigger type="button" id="bir-gun" className={styles.filmButton}>
        <Play size={16} fill="currentColor" aria-hidden="true" />
        Salon filmini izle
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.filmOverlay} />
        <Dialog.Content className={styles.filmDialog}>
          <div className={styles.filmHeader}>
            <div>
              <Dialog.Title>Salonda güne hazırlık</Dialog.Title>
              <Dialog.Description>BeautyAsist salon filmi</Dialog.Description>
            </div>
            <Dialog.Close className={styles.filmClose} aria-label="Filmi kapat">
              <X size={22} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <video
            className={styles.filmVideo}
            aria-label="Güzellik merkezinde güne hazırlık"
            src="/landing/film/kurulum.mp4"
            poster="/landing/film/kurulum.webp"
            controls
            playsInline
            autoPlay
            muted
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
