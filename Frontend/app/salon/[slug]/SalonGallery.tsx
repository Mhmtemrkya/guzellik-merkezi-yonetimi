'use client'

import { Camera, ChevronLeft, ChevronRight, Flower2, X } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import styles from './SalonGallery.module.css'

function hideUnavailablePhoto(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true
}

export default function SalonGallery({ photos, name }: { photos: string[]; name: string }) {
  const images = [...new Set(photos.filter(Boolean))]
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const activeIndex = Math.min(index, images.length - 1)

  function openGallery(trigger: HTMLButtonElement, nextIndex: number) {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return

    openerRef.current = trigger
    setIndex(nextIndex)
    dialog.showModal()
    setOpen(true)
    closeRef.current?.focus({ preventScroll: true })
  }

  function changePhoto(direction: number) {
    setIndex((current) => (Math.min(current, images.length - 1) + direction + images.length) % images.length)
  }

  function handleKeys(event: KeyboardEvent<HTMLDialogElement>) {
    if (images.length < 2 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return

    event.preventDefault()
    changePhoto(event.key === 'ArrowLeft' ? -1 : 1)
  }

  function restoreFocus() {
    setOpen(false)
    openerRef.current?.focus({ preventScroll: true })
    openerRef.current = null
  }

  if (images.length === 0) {
    return (
      <div className={styles.gallery}>
        <div className={styles.empty}>
          <div className={styles.emblem} aria-hidden="true"><Flower2 size={46} strokeWidth={1.2} /></div>
          <p>Galeriye henüz fotoğraf eklenmedi.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.gallery}>
      <div className={styles.mosaic} data-tiles={Math.min(images.length, 3)}>
        {images.slice(0, 3).map((photo, photoIndex) => (
          <button
            key={photo}
            type="button"
            className={photoIndex === 0 ? styles.cover : styles.thumbnail}
            aria-haspopup="dialog"
            aria-label={photoIndex === 0 ? `${name} fotoğraf galerisi, ${images.length} fotoğraf` : `${name} fotoğraf ${photoIndex + 1}`}
            onClick={(event) => openGallery(event.currentTarget, photoIndex)}
          >
            <Camera className={styles.photoFallback} size={28} strokeWidth={1.45} aria-hidden="true" />
            {/* The salon API can return both hosted photos and inline data URLs. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo}
              alt=""
              loading={photoIndex === 0 ? 'eager' : 'lazy'}
              className={styles.tileImage}
              decoding="async"
              onError={hideUnavailablePhoto}
            />
            {photoIndex === 0 && <span className={styles.galleryCount}><Camera size={16} aria-hidden="true" /> {images.length} fotoğraf</span>}
          </button>
        ))}
      </div>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={titleId}
        onKeyDown={handleKeys}
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close() }}
        onClose={restoreFocus}
      >
        <div className={styles.lightbox}>
          <div className={styles.dialogHeader}>
            <div>
              <h2 id={titleId}>{name} fotoğrafları</h2>
              <p role="status" aria-atomic="true">Fotoğraf {activeIndex + 1} / {images.length}</p>
            </div>
            <button ref={closeRef} type="button" className={styles.lightboxButton} aria-label="Galeriyi kapat" onClick={() => dialogRef.current?.close()}>
              <X size={21} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.viewer}>
            <Camera className={styles.photoFallback} size={37} strokeWidth={1.4} aria-hidden="true" />
            {open && (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={images[activeIndex]} src={images[activeIndex]} className={styles.fullImage} alt={`${name} fotoğraf ${activeIndex + 1}`} onError={hideUnavailablePhoto} />
            )}
          </div>
          {images.length > 1 && (
            <div className={styles.controls}>
              <button type="button" className={styles.lightboxButton} aria-label="Önceki fotoğraf" onClick={() => changePhoto(-1)}><ChevronLeft size={21} aria-hidden="true" /></button>
              <button type="button" className={styles.lightboxButton} aria-label="Sonraki fotoğraf" onClick={() => changePhoto(1)}><ChevronRight size={21} aria-hidden="true" /></button>
            </div>
          )}
        </div>
      </dialog>
    </div>
  )
}
