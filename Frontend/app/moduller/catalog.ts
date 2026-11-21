import {
  Bell, Boxes, Building2, Calendar, CalendarCheck, ClipboardList, FileBarChart,
  FileSpreadsheet, FileText, Gift, Globe2, Hourglass, Landmark, LayoutDashboard, Package, PenLine,
  Settings as SettingsIcon, ShieldCheck, Sparkles, Users, Wallet, type LucideIcon,
} from 'lucide-react'

// Permission pages and action keys mirror backend/src/GuzellikMerkezi.Domain/Permissions.cs.

interface Action {
  key: string
  label: string
}

export interface ModulePage {
  key: string
  title: string
  summary: string
  icon: LucideIcon
  actions: Action[]
  /** Bu sayfa personele genelde verilmez (yönetici alanı). */
  adminOnly?: boolean
}

export const pages: ModulePage[] = [
  {
    key: 'Customers',
    title: 'Müşteriler',
    summary: 'Müşteri kartı, bilgi-onay formu ve tedavi günlüğünü görme.',
    icon: Users,
    actions: [
      { key: 'Customers.Manage', label: 'Müşteri ekleme / düzenleme' },
      { key: 'Customers.Delete', label: 'Müşteri silme' },
      { key: 'Customers.Tags', label: 'VIP & kara liste etiketi' },
    ],
  },
  {
    key: 'Appointments',
    title: 'Randevular',
    summary: 'Takvim, çizelge görünümü ve randevuları görme.',
    icon: Calendar,
    actions: [
      { key: 'Appointments.Create', label: 'Randevu oluşturma / düzenleme' },
      { key: 'Appointments.Status', label: 'Durum güncelleme (Tamamlandı / İptal / Gelmedi)' },
      { key: 'Appointments.VoidCompletion', label: 'Yanlış tamamlamayı geri alma (seansı iade eder)' },
    ],
  },
  {
    key: 'Waitlist',
    title: 'Bekleme Listesi',
    summary: 'Dolu güne talep listesini görme.',
    icon: Hourglass,
    actions: [
      { key: 'Waitlist.Manage', label: 'Talep ekleme / kapatma / slot teklifi' },
      { key: 'Waitlist.Convert', label: 'Bekleme kaydını randevuya aktarma' },
    ],
  },
  {
    key: 'Services',
    title: 'Paket, Hizmet & Seans',
    summary: 'Hizmet/paket kataloğu, kampanyalar ve seans takibini görme.',
    icon: Package,
    actions: [
      { key: 'Services.Manage', label: 'Hizmet / paket / kampanya tanımlama' },
      { key: 'Services.Delete', label: 'Hizmet / paket silme (toplu silme dahil)' },
    ],
  },
  {
    key: 'GiftCards',
    title: 'Hediye Çeki & Kupon',
    summary: 'Hediye çeki ve kuponları görme.',
    icon: Gift,
    actions: [{ key: 'GiftCards.Manage', label: 'Çek / kupon tanımlama ve iptal' }],
  },
  {
    key: 'Stock',
    title: 'Stok & Ürün',
    summary: 'Ürün listesi ve kritik stok uyarılarını görme.',
    icon: Boxes,
    actions: [
      { key: 'Stock.Manage', label: 'Ürün tanımlama / düzenleme' },
      { key: 'Stock.Delete', label: 'Ürün silme (toplu silme dahil)' },
      { key: 'Stock.Movements', label: 'Stok giriş / çıkış hareketi' },
    ],
  },
  {
    key: 'CashRegister',
    title: 'Günlük Kasa',
    summary: 'Kasa ve gelir-gider akışını görme.',
    icon: Wallet,
    actions: [{ key: 'CashRegister.Entry', label: 'Gelir / gider girişi' }],
  },
  {
    key: 'CashClosing',
    title: 'Kasa Kapanışı',
    summary: 'Gün sonu Z raporlarını görme.',
    icon: CalendarCheck,
    actions: [{ key: 'CashClosing.Close', label: 'Kapanış kaydı oluşturma (sayım + mutabakat)' }],
  },
  {
    key: 'Accounting',
    title: 'Ön Muhasebe',
    summary: 'Adisyon, cari hesap, taksit ve giderleri görme.',
    icon: Landmark,
    actions: [
      { key: 'Accounting.Adisyon', label: 'Adisyon açma / kalem ekleme' },
      { key: 'Accounting.Accounts', label: 'Cari hesap oluşturma / düzenleme' },
      { key: 'Accounting.Collect', label: 'Tahsilat kaydı alma' },
      { key: 'Accounting.Expenses', label: 'Gider girişi' },
      { key: 'Accounting.VoidRefund', label: 'Yapılmış para iadesini geçersiz kılma' },
      { key: 'Accounting.VoidExpense', label: 'Onaylanmış gideri geçersiz kılma' },
    ],
  },
  {
    key: 'Reports',
    title: 'Raporlar',
    summary: 'Finans, müşteri, personel ve hizmet raporlarını görme (PDF/Excel).',
    icon: FileBarChart,
    actions: [],
  },
  {
    key: 'Notifications',
    title: 'Bildirimler',
    summary: 'Mesaj şablonları, gönderim geçmişi ve etkin kanallardaki otomatik hatırlatmalar.',
    icon: Bell,
    actions: [
      { key: 'Notifications.Send', label: 'SMS / WhatsApp / e-posta gönderimi' },
      { key: 'Notifications.Templates', label: 'Şablon oluşturma / düzenleme' },
    ],
  },
  {
    key: 'Logs',
    title: 'Loglar',
    summary: 'Sistem ve denetim (audit) günlükleri.',
    icon: ClipboardList,
    actions: [],
  },
  {
    key: 'Settings',
    title: 'Ayarlar',
    summary: 'Şube ve genel ayarlar — yönetici alanı.',
    icon: SettingsIcon,
    actions: [],
    adminOnly: true,
  },
]

/** Panelde yalnız kurum yöneticisinde olan, izinle personele açılmayan yetkiler. */
export const administratorTools = [
  'Personel tanımlama, giriş bilgisi üretme ve yetki setini belirleme',
  'Personelin yaptığı taslak işlemleri onaylama ya da reddetme',
  'Şube açma, şubeler arası personel ve veri aktarımı',
  'Paket/abonelik yönetimi, fatura ve ödeme yöntemi',
  'Kurum profili, salon vitrini ve online randevu ayarları',
  'KVKK aydınlatma metni ve onam formu şablonları',
  'Cihaz güvenliği: personelin hangi cihazdan girebileceği',
  'Denetim günlüğü: kim, ne zaman, neyi değiştirdi',
]

/** Personelin yetkisi olmasa da her zaman geçerli olan kurallar. */
export const staffRules = [
  'Onaya tabi personel işlemleri yönetici onaylayana kadar taslakta kalır.',
  'Danışan telefonunun yalnız son 4 hanesini görür, e-posta maskelenir.',
  'Yalnız kendisine açılan şubenin verisini görür.',
  'Sayfa izni yoksa o sayfaya ait hiçbir işlemi yapamaz.',
  'Denetim kayıtlarında işlemi yapan kullanıcı ve işlem zamanı tutulur.',
]

interface Workflow {
  key: string
  title: string
  summary: string
  icon: LucideIcon
  steps: string[]
}

const workflows: Workflow[] = [
  { key: 'Dashboard', title: 'Yönetim paneli', icon: LayoutDashboard,
    summary: 'Randevu ve işletme verilerinin günlük görünümü.',
    steps: ['Günlük randevu ve bekleyen işlemler', 'Gelir özeti ve raporlara geçiş'] },
  { key: 'OnlineBooking', title: 'Salon vitrini ve online randevu', icon: Globe2,
    summary: 'Salonunuzu ziyaretçilere tanıtın ve web ile mobil müşteri portalından randevu talebi alın.',
    steps: ['Hizmetler, fotoğraflar ve çalışma saatleri', 'Gelen randevu talepleri ve müşteri değerlendirmeleri'] },
  { key: 'Consent', title: 'Dijital onam ve imza tableti', icon: PenLine,
    summary: 'Hizmete bağlı onam belgesini danışana tablet üzerinden imzalatın.',
    steps: ['Hizmete göre onam şablonu', 'Müşteri dosyasına imzalı PDF ekleme'] },
  { key: 'Treatment', title: 'Konsültasyon ve işlem günlüğü', icon: FileText,
    summary: 'Danışan beyanlarını ve gerçekleştirilen uygulamaları müşteri kartında takip edin.',
    steps: ['Konsültasyon formu ve özel alanlar', 'Önce ve sonra fotoğrafları', 'VIP, kara liste ve pasif müşteri takibi'] },
  { key: 'Campaigns', title: 'Kampanya ve sadakat', icon: Gift,
    summary: 'Hizmet ve paket kampanyalarını, müşteri sadakat puanlarını yönetin.',
    steps: ['Paket ve hizmet indirimleri', 'Puan kazanımı ve kullanım takibi'] },
  { key: 'Staff', title: 'Personel, prim ve çizelge', icon: Users,
    summary: 'Ekip hesaplarını, programları, izin günlerini ve primleri takip edin.',
    steps: ['Haftalık ve aylık personel çizelgesi', 'Adisyon onayında prim tahakkuku', 'Personel giriş bilgileri PDF’i'] },
  { key: 'Approvals', title: 'Bekleyen onaylar', icon: ShieldCheck,
    summary: 'Onaya tabi personel işlemlerini yönetici olarak inceleyin.',
    steps: ['Taslak işlemleri onaylama veya reddetme', 'İşlem durumunu takip etme'] },
  { key: 'Branches', title: 'Şubeler ve cihaz güvenliği', icon: Building2,
    summary: 'Şubeleri yönetin, personelin erişebildiği verileri ve kullanabildiği cihazları belirleyin.',
    steps: ['Şube seçimi ve şubeler arası personel aktarımı', 'Tanımlı cihaz ve cihaz limiti ayarları'] },
  { key: 'DataTransfer', title: 'Excel ve PDF aktarımı', icon: FileSpreadsheet,
    summary: 'Kayıtları Excel’den içe alın ve dışa aktarın, raporları paylaşılabilir biçimde indirin.',
    steps: ['Müşteri, randevu, hizmet, personel ve şube verileri', 'Raporların Excel ve PDF çıktıları'] },
  { key: 'Subscription', title: 'Abonelik ve faturalar', icon: FileText,
    summary: 'İşletme aboneliğini ve faturalandırma bilgilerini kurum panelinden takip edin.',
    steps: ['Paket, fatura ve ödeme yöntemi yönetimi'] },
  { key: 'Maydi', title: 'Maydi yapay zekâ asistanı', icon: Sparkles,
    summary: 'Panelde bir işlemin nasıl yapıldığını sorun veya erişebildiğiniz günlük veriler hakkında bilgi alın.',
    steps: ['Ekrana göre kullanım rehberi ve günlük işletme soruları', 'Yetkili yöneticiler için Maydi Soruları görünümü'] },
]

export type CatalogEntry = (ModulePage & { kind: 'permission' }) | (Workflow & { kind: 'workflow' })

const entries = new Map<string, CatalogEntry>([
  ...pages.map(page => [page.key, { ...page, kind: 'permission' as const }] as const),
  ...workflows.map(workflow => [workflow.key, { ...workflow, kind: 'workflow' as const }] as const),
])

export const categories = [
  { id: 'planlama', title: 'Planlama ve danışanlar', keys: ['Dashboard', 'Appointments', 'Waitlist', 'Customers', 'OnlineBooking'] },
  { id: 'hizmetler', title: 'Hizmet, seans ve stok', keys: ['Services', 'Consent', 'Treatment', 'Stock'] },
  { id: 'finans', title: 'Finans ve raporlama', keys: ['CashRegister', 'CashClosing', 'Accounting', 'Reports', 'DataTransfer'] },
  { id: 'buyume', title: 'İletişim ve büyüme', keys: ['Notifications', 'GiftCards', 'Campaigns', 'Maydi'] },
  { id: 'yonetim', title: 'Kurum ve ekip', keys: ['Staff', 'Approvals', 'Branches', 'Settings', 'Logs', 'Subscription'] },
].map(({ id, title, keys }) => ({
  id, title, entries: keys.flatMap(key => {
    const entry = entries.get(key)
    return entry ? [entry] : []
  }),
}))
