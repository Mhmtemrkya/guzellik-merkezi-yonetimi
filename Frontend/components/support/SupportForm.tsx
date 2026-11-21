'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import {
  AlertCircle, ArrowRight, Bug, Check, Copy, CreditCard, HelpCircle, Lightbulb,
  Loader2, Mail, Phone, Rocket, Ticket, UserCog, type LucideIcon,
} from 'lucide-react'
import { createSupportTicket, type SupportCategory, type SupportTicketCreated } from '@/lib/supportApi'
import { company } from '@/lib/legal/company'

/**
 * DESTEK FORMU — tanıtım sayfasındaki `/destek` sayfasının kalbi.
 *
 * <p>
 * <b>KATEGORİ ÖNCE SORULUR, SERBEST METİN SONRA.</b> "Nasıl yardımcı olabiliriz?" diye tek bir
 * boş kutu göstermek, kuyruğa sınıflandırılamayan bir yığın üretir: hangi ekibin bakacağı
 * bilinmez ve tekrar eden sorunlar sayılamaz. Kategori, kullanıcıya da yardım eder — ne
 * yazacağını bilmeyene, nereden başlayacağını söyler.
 * </p>
 *
 * <p>
 * <b>ÖNCELİK SORULMAZ.</b> Herkes kendi talebini "Acil" işaretler ve sıralama anlamını yitirir;
 * gerçekten iş durduran talepler o yığında kaybolur. Sıralamayı platform yapar (sunucu da
 * gelen önceliği yok sayar — bkz. SupportService.CreateAsync).
 * </p>
 *
 * <p>
 * <b>BAŞARIDAN SONRA TAKİP KODU VE BAĞLANTISI EKRANDA KALIR.</b> Jeton yalnız bu yanıtta gelir
 * ve bir daha gösterilmez; kullanıcı bağlantıyı kopyalayabilmeli, aksi hâlde e-postası gelmezse
 * (spam kutusu, yanlış adres) talebini bir daha göremezdi.
 * </p>
 */

interface CategoryOption {
  key: SupportCategory
  label: string
  hint: string
  icon: LucideIcon
}

/** Kullanıcının kendi dilinde — "Bug"/"Onboarding" değil, ne yaşadığı. */
const CATEGORIES: CategoryOption[] = [
  { key: 1, label: 'Bir şey çalışmıyor', hint: 'Hata alıyorum, sayfa açılmıyor, kayıt gitmiyor.', icon: Bug },
  { key: 2, label: 'Fatura & abonelik', hint: 'Ödeme, paket yükseltme, fatura sorusu.', icon: CreditCard },
  { key: 4, label: 'Hesap & yetki', hint: 'Giriş yapamıyorum, personel yetkisi, şifre.', icon: UserCog },
  { key: 5, label: 'Kurulum & veri aktarımı', hint: 'Başlangıç, eski verilerimi taşıma, eğitim.', icon: Rocket },
  { key: 3, label: 'Özellik isteği', hint: 'Şu olsa çok iyi olurdu…', icon: Lightbulb },
  { key: 0, label: 'Genel soru', hint: 'Diğer her şey.', icon: HelpCircle },
]

const fade: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
}

const labelCls = 'mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ba-brand-muted)]'
const fieldCls =
  'min-h-12 w-full rounded-xl border border-[color:var(--ba-brand-line)] bg-white px-4 text-base text-[color:var(--ba-brand-ink)] outline-none transition-colors placeholder:text-[color:var(--ba-brand-muted)] focus:border-[color:var(--ba-brand-accent)] focus:ring-2 focus:ring-[color:var(--ba-brand-light)] sm:text-[14px]'

export default function SupportForm({ signedIn = false }: { signedIn?: boolean }) {
  const [category, setCategory] = useState<SupportCategory>(1)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<SupportTicketCreated | null>(null)
  const [copied, setCopied] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')

    if (subject.trim().length < 3) return setError('Lütfen kısa bir konu başlığı yazın.')
    if (message.trim().length < 10) return setError('Sorununuzu biraz daha ayrıntılı anlatır mısınız? (En az 10 karakter)')
    // Giriş yapmışsa ad/e-posta SUNUCUDAN gelir — burada sorulmaz ve doğrulanmaz.
    if (!signedIn) {
      if (name.trim().length < 2) return setError('Adınızı ve soyadınızı yazın.')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Geçerli bir e-posta adresi girin.')
    }

    setLoading(true)
    try {
      setCreated(
        await createSupportTicket({
          subject: subject.trim(),
          message: message.trim(),
          name: signedIn ? null : name.trim(),
          email: signedIn ? null : email.trim(),
          phone: phone.trim() || null,
          category,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Talebiniz gönderilemedi. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  const copyLink = async (): Promise<void> => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(absoluteTrackUrl(created))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* pano izni yoksa sessiz geç — bağlantı zaten ekranda yazılı */
    }
  }

  // ---------------------------------------------------------------- BAŞARI
  if (created) {
    const trackHref = relativeTrackHref(created)
    return (
      <motion.div variants={fade} initial="hidden" animate="visible" className="rounded-[22px] border border-[color:var(--ba-brand-line)] bg-white p-5 sm:p-9">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
          <Check className="h-6 w-6" strokeWidth={2.2} />
        </span>
        <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-[color:var(--ba-brand-ink)]">Talebiniz bize ulaştı.</h2>
        <p className="on-material mt-2 text-[14px] leading-relaxed text-[color:var(--ba-brand-muted)]">
          Takip kodunuzu e-postanıza da gönderdik. Ekibimiz en kısa sürede yanıt yazacak.
        </p>

        <div className="mt-6 rounded-2xl border border-[color:var(--ba-brand-line)] bg-white p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ba-brand-muted)]">Takip kodunuz</div>
          <div className="mt-1.5 font-mono text-[26px] font-bold tracking-[0.04em] text-[color:var(--ba-brand-accent)]">{created.code}</div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-[color:var(--ba-brand-muted)]">
            Talebinizi görüntülemek ve yanıt yazmak için aşağıdaki bağlantıyı kullanın.
            <b className="text-[color:var(--ba-brand-ink)]"> Bu bağlantı size özeldir; saklayın ve paylaşmayın.</b>
          </p>

          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link
              href={trackHref}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[color:var(--ba-brand-accent)] px-5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Ticket className="h-4 w-4" /> Talebimi görüntüle
            </Link>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[color:var(--ba-brand-line)] bg-white px-5 text-[13px] font-medium text-[color:var(--ba-brand-muted)] transition-colors hover:border-[color:var(--ba-brand-accent)]"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Kopyalandı' : 'Bağlantıyı kopyala'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreated(null)
            setSubject('')
            setMessage('')
          }}
          className="mt-5 text-[13px] font-medium text-[color:var(--ba-brand-accent)] transition-colors hover:text-[color:var(--ba-brand-accent)]"
        >
          Başka bir talep oluştur
        </button>
      </motion.div>
    )
  }

  // ---------------------------------------------------------------- FORM
  return (
    <form onSubmit={submit} className="rounded-[22px] border border-[color:var(--ba-brand-line)] bg-white p-4 sm:p-8">
      <fieldset className="min-w-0">
        <legend className={labelCls}>Konu hangisi?</legend>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {CATEGORIES.map(({ key, label, hint, icon: Icon }) => {
            const active = category === key
            return (
              <motion.button
                key={key}
                type="button"
                whileTap={{ scale: 0.985 }}
                onClick={() => setCategory(key)}
                aria-pressed={active}
                className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                  active
                    ? 'border-[color:var(--ba-brand-accent)] bg-[color:var(--ba-brand-blush)] shadow-[0_12px_30px_-22px_rgba(200,87,118,0.6)]'
                    : 'border-[color:var(--ba-brand-line)] bg-white hover:border-[color:var(--ba-brand-pink)]'
                }`}
              >
                <Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-[color:var(--ba-brand-accent)]' : 'text-[color:var(--ba-brand-muted)]'}`}
                  strokeWidth={1.8}
                />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-[color:var(--ba-brand-ink)]">{label}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-[color:var(--ba-brand-muted)]">{hint}</span>
                </span>
              </motion.button>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-6">
        <label className={labelCls} htmlFor="sup-subject">
          Konu başlığı
        </label>
        <input
          id="sup-subject"
          type="text"
          maxLength={180}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={fieldCls}
          placeholder="Örn. Randevu tamamlanınca seans düşmüyor"
        />
      </div>

      <div className="mt-5">
        <label className={labelCls} htmlFor="sup-message">
          Ne oldu?
        </label>
        <textarea
          id="sup-message"
          rows={6}
          maxLength={4000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={`${fieldCls} min-h-[150px] resize-y py-3.5 leading-relaxed`}
          placeholder="Adım adım ne yaptığınızı ve ne beklediğinizi yazarsanız çok daha hızlı çözeriz. Varsa hata mesajını da ekleyin."
        />
        <div className="mt-1.5 text-right text-[11px] text-[color:var(--ba-brand-muted)]">{message.length}/4000</div>
      </div>

      {/* KİMLİK — yalnız oturumsuz ziyaretçiye sorulur. Giriş yapmış kullanıcıda bu alanlar
          sunucudaki oturumdan okunur ve formdaki değerler yok sayılır. */}
      {!signedIn ? (
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="sup-name">
              Ad soyad
            </label>
            <input
              id="sup-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldCls}
              placeholder="Ayşe Yılmaz"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="sup-email">
              E-posta
            </label>
            <input
              id="sup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldCls}
              placeholder="ayse@guzelsalon.com"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="sup-phone">
              Telefon <span className="font-normal normal-case tracking-normal text-[color:var(--ba-brand-muted)]">(isteğe bağlı)</span>
            </label>
            <input
              id="sup-phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={fieldCls}
              placeholder="05XX XXX XX XX"
            />
          </div>
        </div>
      ) : (
        <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-[color:var(--ba-brand-line)] bg-white px-4 py-3.5 text-[12.5px] leading-relaxed text-[color:var(--ba-brand-muted)]">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--ba-brand-accent)]" />
          <span>
            Giriş yaptığınız için talep <b>kurumunuza bağlanır</b> ve yanıt hesap e-postanıza
            gelir. Panelinizden de takip edebilirsiniz.
          </span>
        </div>
      )}

      <AnimatePresence>
        {error && (
          <motion.div
            variants={fade}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-2xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-[12.5px] leading-relaxed text-rose-700"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="submit"
        disabled={loading}
        className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--ba-brand-accent)] text-[14px] font-semibold text-white transition-colors hover:bg-[color:var(--ba-brand-ink)] disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        {loading ? 'Gönderiliyor' : 'Talebi gönder'}
      </button>

      <p className="mt-3.5 text-center text-[11.5px] leading-relaxed text-[color:var(--ba-brand-muted)]">
        Ortalama ilk yanıt süremiz birkaç saattir. Acil durumlarda{' '}
        <a href={`tel:${company.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 font-semibold text-[color:var(--ba-brand-accent)] hover:underline">
          <Phone className="h-3 w-3" aria-hidden="true" /> {company.phone}
        </a>
      </p>
    </form>
  )
}

/** Panoya kopyalanacak TAM adres (e-postadaki bağlantıyla aynı olsun). */
function absoluteTrackUrl(created: SupportTicketCreated): string {
  const relative = relativeTrackHref(created)
  return typeof window === 'undefined' ? relative : `${window.location.origin}${relative}`
}

/**
 * Takip bağlantısı — SUNUCUDAN GELENİ KULLANMAYIZ.
 *
 * Sunucudaki `trackUrl`, yapılandırmadaki genel adrese (`App:PublicBaseUrl`) göre kurulur ve
 * e-posta için doğrudur. Tarayıcıda ise kullanıcının bulunduğu köken geçerlidir: yerelde
 * çalışırken canlı adrese, önizleme adresinde canlıya gitmemeli. Kod ve jeton aynı olduğu
 * için bağlantıyı burada yeniden kurmak güvenlidir.
 */
function relativeTrackHref(created: SupportTicketCreated): string {
  const query = new URLSearchParams({ kod: created.code, jeton: created.accessToken })
  return `/destek/takip?${query.toString()}`
}
