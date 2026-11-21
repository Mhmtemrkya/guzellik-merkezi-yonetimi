import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import PaymentBadges, { LegalLinkRow } from '@/components/legal/PaymentBadges'
import { planFeatureLabels, planLimitLabels, tierLabels, type PublicPlan } from '@/lib/plans'
import PlanPicker from './apple/PlanPicker'
import styles from './LandingPricing.module.css'

const lira = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export default function LandingPricing({ plans }: { plans: PublicPlan[] | null }) {
  const shown = plans?.slice(0, 4) ?? []
  const featuredIndex = shown.length >= 3 ? 1 : shown.length - 1

  return (
    <section className={styles.pricing} id="fiyat" aria-labelledby="landing-pricing-heading">
      <header className={styles.header}>
        <p className={styles.label}>Fiyatlandırma</p>
        <h2 id="landing-pricing-heading">Merkezinize uygun plan.</h2>
      </header>

      {shown.length > 0 ? (
        <>
          {shown.length > 1 && <p className={styles.scrollHint}>Diğer planlar için yana kaydırın.</p>}
          <ul className={styles.planList} data-count={shown.length} role="list">
            {shown.map((plan, index) => (
              <li key={plan.id}>
                <PlanCard plan={plan} featured={index === featuredIndex} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className={styles.quote}>
          <div>
            <h3>Size özel teklif hazırlayalım.</h3>
            <p>Merkezinize uygun planı ve şube seçeneklerini birlikte değerlendirelim.</p>
          </div>
          <Link className={styles.quoteLink} href="/login">
            Teklif iste <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      )}

      <div className={styles.payment}>
        <PaymentBadges />
        <LegalLinkRow className={styles.legal} />
      </div>
    </section>
  )
}

function PlanCard({ plan, featured }: { plan: PublicPlan; featured: boolean }) {
  const period = plan.monthlyPriceTRY > 0 ? 'monthly' : 'yearly'
  const price = period === 'monthly' ? plan.monthlyPriceTRY : plan.yearlyPriceTRY
  const yearlyPerMonth = plan.yearlyPriceTRY / 12
  const offersAnnualDiscount = period === 'monthly' && yearlyPerMonth > 0 && yearlyPerMonth < price * 0.99
  const limits = planLimitLabels(plan)
  const features = planFeatureLabels(plan.features, 4)
  const tiers = [...tierLabels(plan.customerTiers, 'müşteri'), ...tierLabels(plan.consentTiers, 'imzalı onam')]

  return (
    <article className={styles.planCard} data-featured={featured || undefined}>
      <h3>{plan.name}</h3>
      {plan.description && <p className={styles.description}>{plan.description}</p>}

      <p className={styles.priceLine}>
        <span className={styles.amount}>{lira.format(price)}</span>
        <span>/{period === 'monthly' ? 'ay' : 'yıl'} + KDV</span>
      </p>
      {plan.chargePerBranch && <p className={styles.branch}>Şube başına</p>}
      {offersAnnualDiscount && (
        <p className={styles.discount}>
          Yıllık ödemede {lira.format(yearlyPerMonth)}/ay ({lira.format(plan.yearlyPriceTRY)}/yıl + KDV)
        </p>
      )}

      <ul className={styles.features} role="list">
        {[...limits, ...features].map((feature) => (
          <li key={feature}><Check size={15} aria-hidden="true" />{feature}</li>
        ))}
      </ul>

      {tiers.length > 0 && (
        <div className={styles.tiers}>
          <p>Hacme göre ek ücret (+ KDV)</p>
          <ul>{tiers.map((tier) => <li key={tier}>{tier}</li>)}</ul>
        </div>
      )}

      <div className={styles.planAction}>
        <PlanPicker
          planId={plan.id}
          planName={plan.name}
          priceTRY={price}
          period={period}
          featured={featured}
        />
      </div>
    </article>
  )
}
