'use client'

import { useId, useState } from 'react'
import { CalendarDays, ListChecks, Sparkles } from 'lucide-react'
import styles from './MaydiDemo.module.css'

const examples = [
  {
    id: 'agenda',
    label: 'Günün ajandası',
    question: 'Bugün kaç randevum var?',
    answer: 'Bugün 8 randevun var. Sıradaki randevu saat 10.30’da.',
    icon: CalendarDays,
  },
  {
    id: 'guide',
    label: 'Randevu açma',
    question: 'Nasıl randevu oluştururum?',
    answer: 'Randevular’da “Yeni Randevu”yu aç. Danışanı, hizmeti, personeli ve saati seç.',
    icon: ListChecks,
  },
] as const

export default function MaydiDemo({ className = '' }: { className?: string }) {
  const [current, setCurrent] = useState<(typeof examples)[number]>(examples[0])
  const conversationId = useId()

  return (
    <div className={`${styles.card} ${className}`}>
      <p className={styles.header}>
        <span className={styles.mark}><Sparkles size={14} aria-hidden="true" /></span>
        Örnek sohbet
      </p>
      <div id={conversationId} className={styles.conversation} aria-live="polite" aria-atomic="true">
        <p className={styles.question}><span className="sr-only">Siz. </span>{current.question}</p>
        <p className={styles.answer}><span className="sr-only">Maydi. </span>{current.answer}</p>
      </div>
      <div className={styles.prompts} role="group" aria-label="Örnek sorular">
        {examples.map((example) => (
          <button
            key={example.id}
            type="button"
            aria-pressed={current.id === example.id}
            aria-controls={conversationId}
            className={styles.prompt}
            onClick={() => setCurrent(example)}
          >
            <example.icon size={14} aria-hidden="true" />
            {example.label}
          </button>
        ))}
      </div>
    </div>
  )
}
