import type { Metadata } from 'next'
import PublicNavbar from '@/components/public/PublicNavbar'
import SalonDirectory from './SalonDirectory'
import styles from './salonlar.module.css'

export const metadata: Metadata = {
  title: 'Salonlar | BeautyAsist',
  description: 'Güzellik salonlarını şehre ve hizmete göre keşfedin. Salon profillerini, hizmetleri ve müşteri yorumlarını inceleyip online randevu alın.',
}

export default function SalonListPage() {
  return (
    <div className={styles.directory}>
      <PublicNavbar />
      <SalonDirectory />
    </div>
  )
}
