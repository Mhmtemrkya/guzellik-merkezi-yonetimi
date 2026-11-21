'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { CalendarDays, UsersRound, WalletCards } from 'lucide-react'
import Image from 'next/image'
import styles from './StudioPreview.module.css'

const views = [
  {
    id: 'randevu',
    label: 'Randevu',
    title: 'Günün ajandası',
    summary: '3 randevu',
    icon: CalendarDays,
    entries: [
      { marker: '09.00', name: 'Elif Aydın', detail: 'Lazer epilasyon', value: 'Tamamlandı', tone: 'green' },
      { marker: '10.30', name: 'Ayşe Demir', detail: 'Cilt bakımı', value: 'İşlemde', tone: 'coral' },
      { marker: '11.15', name: 'Merve Şahin', detail: 'Bölgesel incelme', value: 'Bekliyor', tone: 'amber' },
    ],
  },
  {
    id: 'danisan',
    label: 'Danışan',
    title: 'Danışan kartları',
    summary: '3 danışan',
    icon: UsersRound,
    entries: [
      { marker: 'EA', name: 'Elif Aydın', detail: 'Lazer epilasyon paketi', value: '2 seans kaldı', tone: 'neutral' },
      { marker: 'AD', name: 'Ayşe Demir', detail: 'Dijital onam', value: 'İmzalı', tone: 'green' },
      { marker: 'MŞ', name: 'Merve Şahin', detail: 'Bölgesel incelme paketi', value: '4 seans kaldı', tone: 'neutral' },
    ],
  },
  {
    id: 'kasa',
    label: 'Kasa',
    title: 'Gün sonu kasası',
    summary: 'Toplam ₺4.850',
    icon: WalletCards,
    entries: [
      { marker: '₺', name: 'Nakit', detail: '2 tahsilat', value: '₺1.200', tone: 'amount' },
      { marker: '₺', name: 'Kart', detail: '3 tahsilat', value: '₺3.250', tone: 'amount' },
      { marker: '₺', name: 'Havale', detail: '1 tahsilat', value: '₺400', tone: 'amount' },
    ],
  },
] as const

export type StudioView = (typeof views)[number]['id']

export default function StudioPreview({
  value,
  onValueChange,
}: {
  value: StudioView
  onValueChange: (value: StudioView) => void
}) {
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => onValueChange(next as StudioView)}
      className={styles.preview}
    >
      <div className={styles.toolbar}>
        <div className={styles.brand}>
          <Image src="/logo.png" width={30} height={30} alt="" />
          BeautyAsist
        </div>
        <span className={styles.badge}>Örnek panel</span>
      </div>

      <Tabs.List aria-label="Örnek panel bölümleri" className={styles.tabs}>
        {views.map(({ id, label, icon: Icon }) => (
          <Tabs.Trigger key={id} value={id} className={styles.tab}>
            <Icon size={15} strokeWidth={1.85} aria-hidden="true" />
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {views.map(({ id, title, summary, entries }) => (
        <Tabs.Content key={id} value={id} className={styles.content}>
          <div className={styles.contentHead}>
            <h3>{title}</h3>
            <span>{summary}</span>
          </div>
          <ul className={styles.entries}>
            {entries.map(({ marker, name, detail, value, tone }) => (
              <li key={name} className={styles.entry}>
                <span className={styles.marker} aria-hidden={id !== 'randevu' ? 'true' : undefined}>{marker}</span>
                <span className={styles.description}>
                  <strong>{name}</strong>
                  <span>{detail}</span>
                </span>
                <span className={styles.value} data-tone={tone}>{value}</span>
              </li>
            ))}
          </ul>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  )
}
