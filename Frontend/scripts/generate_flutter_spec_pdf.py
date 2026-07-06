from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, HRFlowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from datetime import datetime
from pathlib import Path

OUT = Path('/home/kaya/projects/guzellik-frontend/BeautyAsist-Flutter-Mobil-Uygulama-Brief.pdf')
MD = Path('/home/kaya/projects/guzellik-frontend/BeautyAsist-Flutter-Mobil-Uygulama-Brief.md')

pdfmetrics.registerFont(TTFont('DejaVu', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DejaVu-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))

styles = getSampleStyleSheet()
for s in styles.byName.values():
    s.fontName = 'DejaVu'
styles.add(ParagraphStyle('CoverTitle', parent=styles['Title'], fontName='DejaVu-Bold', fontSize=28, leading=34, textColor=HexColor('#160f13'), alignment=TA_CENTER, spaceAfter=18))
styles.add(ParagraphStyle('H1x', parent=styles['Heading1'], fontName='DejaVu-Bold', fontSize=18, leading=23, textColor=HexColor('#160f13'), spaceBefore=12, spaceAfter=8))
styles.add(ParagraphStyle('H2x', parent=styles['Heading2'], fontName='DejaVu-Bold', fontSize=13, leading=17, textColor=HexColor('#A96B45'), spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle('Bodyx', parent=styles['BodyText'], fontName='DejaVu', fontSize=9.2, leading=13.2, textColor=HexColor('#20181b'), spaceAfter=5))
styles.add(ParagraphStyle('Smallx', parent=styles['BodyText'], fontName='DejaVu', fontSize=8, leading=11, textColor=HexColor('#4b3d42'), spaceAfter=3))
styles.add(ParagraphStyle('Bulletx', parent=styles['BodyText'], fontName='DejaVu', fontSize=8.8, leading=12.5, leftIndent=12, firstLineIndent=-8, bulletIndent=0, spaceAfter=3))
styles.add(ParagraphStyle('TableHead', parent=styles['BodyText'], fontName='DejaVu-Bold', fontSize=7.6, leading=9.8, textColor=colors.white))
styles.add(ParagraphStyle('TableCell', parent=styles['BodyText'], fontName='DejaVu', fontSize=7.2, leading=9.5, textColor=HexColor('#20181b')))

def P(text, style='Bodyx'):
    text = str(text).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('\n','<br/>')
    return Paragraph(text, styles[style])

def bullet(text):
    return Paragraph('• ' + text.replace('&','&amp;'), styles['Bulletx'])

def h1(t): return P(t, 'H1x')
def h2(t): return P(t, 'H2x')

def table(rows, widths=None):
    data=[]
    for ri,row in enumerate(rows):
        data.append([P(c, 'TableHead' if ri==0 else 'TableCell') for c in row])
    t=Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),HexColor('#160f13')),
        ('GRID',(0,0),(-1,-1),0.35,HexColor('#d7a373')),
        ('VALIGN',(0,0),(-1,-1),'TOP'),
        ('BACKGROUND',(0,1),(-1,-1),HexColor('#fff8ef')),
        ('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),
    ]))
    return t

admin_pages = [
('Dashboard','/admin','Kurum yöneticisi ana ekranı: günlük randevu, aylık tahsilat, toplam alacak, aktif müşteri, kritik stok, randevu durumu ve onay özeti.','Stat kartları, bugünkü randevular, onay bekleyen işlemler, hızlı özetler.'),
('Müşteriler','/admin/musteriler','Müşteri kartı içinde paket, ödeme geçmişi, kalan borç, taksit ve seans takibi.','Yeni müşteri, kart düzenleme, ödeme alma, yeniden taksitlendirme, randevu bağlama.'),
('Paket & Hizmet','/admin/paketler','Önce hizmet ekleme, sonra seçili hizmetlerle seanslı/taksitli paket oluşturma.','Hizmet ekle, çoklu hizmet seç, paket oluştur, paket/hizmet düzenle. Mobilde multi-select dropdown zorunlu.'),
('Randevular','/admin/randevular','Aylık çizelge üzerinden müşteri, hizmet, personel ve seans durum takibi.','Takvim, günlük slotlar, randevu oluştur/düzenle, durum: tamamlandı/devam/bekliyor.'),
('Günlük Kasa','/admin/kasa','Günlük gelir-gider ve tahsilat hareketleri.','Nakit/kart/havale, işlem tipi, tutar, hedef, personel, onay notu.'),
('Ön Muhasebe','/admin/on-muhasebe','Kasa, gelir-gider, cari, geciken ödeme, ödeme çizelgesi, tahsilat, prim, muhasebeci raporu.','Ödeme al, yeniden taksitlendir, gelir/gider ekle, cari ekstre, toplu bildirim, dışa aktar.'),
('Onay Bekleyenler','/admin/onaylar','Personel işlemlerinin yönetici onayı.','Onayla/reddet, red sebebi, onay notu, tutar, talep eden.'),
('Personel & Roller','/admin/personel','Personel listesi, rol, departman, iletişim, durum, performans.','Personel ekle, profil düzenle, rol/yetki kurgusu.'),
('Bildirimler','/admin/bildirimler','Randevu, ödeme, kalan seans ve yönetici onay bildirimleri.','WhatsApp/SMS/E-posta kanalı, hedef grup, tetikleyici, kuyruk ve durum.'),
('Raporlar','/admin/raporlar','Tahsilat, açık alacak, geciken ödeme, paket ve personel performans raporları.','Grafikler, PDF/Excel çıktı, KPI kartları.'),
('Stok & Ürün','/admin/stok','Premium stok: ürün kartı, stok giriş/çıkış, tedarikçi, depo/raf, minimum stok.','Ürün ekle, stok gir/çık, sayım, barkod, sipariş, Excel transferi.'),
('Ayarlar','/admin/ayarlar','Kurum bilgileri, abonelik, finans kuralları, yetkiler ve veri ayarları.','Kurum profili, abonelik, finans, veri ve ek hizmet ayarları.'),
]

personel_pages = [
('Personel Dashboard','/personel','Personelin günlük operasyon ekranı.','Bugünkü randevular, aylık seans, performans, onay bekleyenler, hızlı seans tamamlama ve müşteri notu.'),
('Müşterilerim','/personel/musteriler','Personelin hizmet verdiği müşteriler.','Müşteri listesi, kalan seans, paket durumu, not ekleme, paket satış talebi.'),
('Randevularım','/personel/randevular','Atanan randevular ve seans akışı.','Günlük çizelge, randevu talebi, seansı tamamlama, erteleme, not.'),
('Seanslarım','/personel/seanslar','Paket içindeki seansların kullanımı.','Seans tamamlama, yeni seans/randevu talebi, kalan seans, dışa aktar.'),
('Paket Satışı','/personel/paketler','Personelin paket satış talebi oluşturması.','Müşteri, seçilen hizmetler, peşinat, taksit sayısı, yönetici onayı.'),
('Kasa / Tahsilat','/personel/kasa','Personel ödeme/tahsilat talebi.','Müşteri, tutar, yöntem, açıklama, onay durumu, kendi kasa özeti.'),
('Stok Kullanımı','/personel/stok','Personel stok sayımı yapmaz; kullanım ve talep kaydı oluşturur.','Sarf çıkışı, stok talebi, ürün havuzu, hareketlerim.'),
('Performansım','/personel/raporlar','Kişisel performans ve rapor ekranı.','Seans, satış, onay, skor, haftalık dağılım, rapor filtresi/dışa aktar.'),
('Bildirimlerim','/personel/bildirimler','Kişisel bildirim akışı.','Randevu hatırlatma, onay sonuçları, stok talepleri, okundu işaretleme.'),
('İşlem Geçmişim','/personel/loglar','Personelin yaptığı işlemler ve onay durumları.','Onaylı/bekliyor/reddedildi, filtre, dışa aktar, düzeltme talebi.'),
('Profilim','/personel/profil','Kişisel bilgiler, çalışma saatleri, yetki görüntüleme, güvenlik.','Profil düzenleme, parola, çalışma saatleri, bildirim tercihleri, yetki talebi.'),
]

platform_pages = [
('Platform Overview','/platform','BeautyAsist tenant yönetimi.','Toplam kurum, MRR, toplam kullanıcı, uptime, kurum tablosu, durum etiketleri.'),
('Tüm Kurumlar','/platform/kurumlar','Platform genelinde kurum listesi.','Şu an ComingSoon; mobilde kurum kartları, plan, durum, kullanıcı sayısı planlanmalı.'),
('Sağlık Uyarıları','/platform/uyarilar','Kritik kurum/sistem uyarıları.','Şu an ComingSoon; mobilde kritik uyarı listesi ve filtreler planlanmalı.'),
('MRR & Abonelik','/platform/finans','Gelir, churn ve abonelik metrikleri.','Şu an ComingSoon; mobilde finans KPI ve trend grafikleri planlanmalı.'),
('Faturalama','/platform/fatura','Kurum faturaları.','Şu an ComingSoon; mobilde fatura listesi, durum ve ödeme takibi planlanmalı.'),
('Sistem Ayarları','/platform/sistem','Global ayarlar ve plan tanımları.','Şu an ComingSoon; mobilde sadece yetkili erişimle ayar formları planlanmalı.'),
]

landing_pages = [
('Landing / Ana Sayfa','/','BeautyAsist pazarlama sayfası: hero, problem akışı, çözüm, modüller, müşteri demo, süreç, fiyatlandırma, SSS, footer.'),
('Login','/login','Rol seçerek giriş: Kurum Yöneticisi -> /admin, Personel -> /personel, Platform Admin -> /platform. Mobilde aynı rol seçimi korunmalı.'),
]

story=[]
story.append(Spacer(1, 2.2*cm))
story.append(P('BeautyAsist', 'CoverTitle'))
story.append(P('Flutter Mobil Uygulama Geliştirme Brief’i', 'CoverTitle'))
story.append(P('Web uygulamasındaki paneller, sayfalar, özellikler, görsel kimlik ve mobil uygulama gereksinimleri.', 'Bodyx'))
story.append(Spacer(1, 0.5*cm))
story.append(P(f'Hazırlanma tarihi: {datetime.now().strftime("%d.%m.%Y %H:%M")}', 'Smallx'))
story.append(P('Kaynak proje: /home/kaya/projects/guzellik-frontend', 'Smallx'))
story.append(PageBreak())

story.append(h1('1. Ürün Özeti'))
for b in [
    'BeautyAsist; güzellik merkezleri için müşteri, paket/hizmet, taksit, seans, randevu, kasa, ön muhasebe, bildirim, stok ve raporlama yönetimidir.',
    'Mobil uygulama Flutter ile hazırlanırken üç ana rol korunmalıdır: Kurum Yöneticisi, Personel, Platform Admin.',
    'Kurum içi veriler tenant/kurum bazlı ayrılmalıdır. Mobil taraf cache/local storage kullanırsa anahtarlar kurum/tenant ID ile ayrılmalıdır.',
    'Personel mobil deneyiminde hızlı işlem, randevu/seans/tahsilat akışı önceliklidir; yönetici mobilde tüm kurum operasyonunu görmelidir.',
]: story.append(bullet(b))

story.append(h1('2. Görsel Kimlik ve UI Kuralları'))
story.append(table([
    ['Token', 'Değer', 'Kullanım'],
    ['arm-bg', '#160f13', 'Ana koyu bordo/siyah arka plan'],
    ['arm-bg-soft', '#24171d', 'Kart arka planı, hover yüzeyi'],
    ['arm-cream', '#fff2df', 'Ana yazı, ince çizgi; yoğun beyaz yüzey olarak kullanılmamalı'],
    ['arm-gold', '#d7a373', 'CTA, vurgu, aktif border, ikon vurgusu'],
    ['arm-rose', '#f2b6c8', 'İkincil vurgu, gradient geçişleri'],
    ['arm-copper', '#a96b45', 'Başlık/etiket sıcak tonu'],
], [3*cm,3*cm,10*cm]))
for b in [
    'Font: Webde display başlıklarda Fraunces, metinlerde Inter kullanılıyor. Flutter’da öneri: başlık için Playfair Display veya Fraunces benzeri; gövde için Inter/GoogleFonts.inter.',
    'Tema: dark-first. Kartlar koyu yüzeyde ince #fff2df/10 border ile ayrılmalı. Hover/aktif durumda tam krem zemin yerine #24171d + altın border kullanılmalı.',
    'Logo: arka plansız kullanılmalı; kare/rounded kutu, border ve glow kaldırıldı. Mobilde şeffaf PNG/SVG tercih edilmeli.',
    'Bileşen dili: keskin gridler, ince çizgiler, monospaced küçük etiketler, büyük serif başlıklar, altın/pudra gradient vurgu.',
]: story.append(bullet(b))

story.append(h1('3. Mobil Navigasyon Önerisi'))
story.append(h2('Kurum Yöneticisi'))
for b in ['Alt tab: Dashboard, Müşteriler, Randevular, Kasa, Menü.', 'Menü içinde: Paketler, Ön Muhasebe, Onaylar, Personel, Bildirimler, Raporlar, Stok, Ayarlar.', 'Kritik aksiyonlar için floating action button: müşteri ekle, randevu oluştur, ödeme al.']:
    story.append(bullet(b))
story.append(h2('Personel'))
for b in ['Alt tab: Bugün, Müşterilerim, Randevularım, Seanslarım, Menü.', 'Menü içinde: Paket Satışı, Kasa/Tahsilat, Stok, Performans, Bildirimler, Loglar, Profil.', 'Personel işlemlerinde “Yönetici onayı bekliyor” durumları açık gösterilmeli.']:
    story.append(bullet(b))
story.append(h2('Platform Admin'))
for b in ['Alt tab: Overview, Kurumlar, Uyarılar, Finans, Menü.', 'ComingSoon olan web sayfaları mobilde tasarım iskeleti olarak planlanabilir; canlı veri gelene kadar boş state ve demo kartlar kullanılabilir.']:
    story.append(bullet(b))

story.append(PageBreak())
story.append(h1('4. Landing ve Login'))
story.append(table([['Sayfa','Route','Mobil karşılığı']] + landing_pages, [4*cm,3*cm,9*cm]))
story.append(h2('Login rol seçenekleri'))
for b in ['Kurum Yöneticisi: güzellik merkezi sahibi/yönetici; /admin paneline gider.', 'Personel: estetisyen/resepsiyon/muhasebe; /personel paneline gider.', 'Platform Admin: BeautyAsist ekibi; /platform paneline gider.', 'Mobilde gerçek auth gelene kadar rol seçimi + demo login korunabilir.']:
    story.append(bullet(b))

story.append(PageBreak())
story.append(h1('5. Kurum Yöneticisi Paneli — Sayfa Sayfa'))
story.append(table([['Sayfa','Route','Amaç','Mobilde olması gerekenler']] + admin_pages, [3.1*cm,3.1*cm,4.6*cm,5.2*cm]))
story.append(h2('Admin panel genel veri tipleri'))
for b in ['Müşteri: ad, telefon, şehir, paket, toplam satış, peşinat, taksit, kalan borç, seans özeti, notlar.', 'Paket/Hizmet: hizmet adı, kategori, varsayılan seans, birim fiyat, süre, açıklama; paket adı, seçili hizmetler, toplam tutar, peşinat, taksit.', 'Randevu: müşteri, paket/hizmet, personel, tarih, saat, süre, durum.', 'Kasa/Ödeme: işlem tipi, tutar, ödeme yöntemi, müşteri/açıklama, saat, personel, onay notu.', 'Stok: ürün adı, kategori, SKU/barkod, stok, minimum stok, birim, maliyet, satış fiyatı, tedarikçi, depo/raf.']:
    story.append(bullet(b))

story.append(PageBreak())
story.append(h1('6. Personel Paneli — Sayfa Sayfa'))
story.append(table([['Sayfa','Route','Amaç','Mobilde olması gerekenler']] + personel_pages, [3.2*cm,3.3*cm,4.5*cm,5.0*cm]))
story.append(h2('Personel yetki ve onay mantığı'))
for b in ['Personel her modülü tam yönetmez; kendi yetkisi kapsamındaki randevu, müşteri, seans, tahsilat, stok kullanım/talep işlemlerini yapar.', 'Paket satışı, tahsilat, seans tamamlama, stok talebi gibi kritik işlemler loglanır ve gerekiyorsa yönetici onayına düşer.', 'Mobilde her işlem sonrası durum etiketi gösterilmeli: Onay bekliyor, Onaylı, Reddedildi, Tamamlandı, Bekliyor.']:
    story.append(bullet(b))

story.append(PageBreak())
story.append(h1('7. Platform Admin Paneli — Sayfa Sayfa'))
story.append(table([['Sayfa','Route','Amaç','Mobilde olması gerekenler']] + platform_pages, [3.2*cm,3.2*cm,4.8*cm,4.8*cm]))

story.append(h1('8. Form ve Etkileşim Kuralları'))
for b in [
    'Seçilen hizmetler alanı çoklu seçim dropdown olmalı. Kullanıcı istediği kadar kayıtlı hizmet seçebilmeli; seçilenler chip/badge olarak gösterilmeli.',
    'Tutar alanları Türk Lirası formatında gösterilmeli: ₺25.000 veya 25.000 ₺; girişte numeric keyboard kullanılmalı.',
    'Tarih/saat seçimleri native picker + hızlı slot önerisi ile yapılmalı.',
    'Listelerde arama, filtre ve durum segmentleri mobil için üstte sticky compact bar olarak tasarlanmalı.',
    'PDF/Excel dışa aktar webde var; mobilde “Paylaş / indir” aksiyonu olarak konumlandırılmalı.',
    'Boş durumlarda koyu zemin üzerinde kısa açıklama + birincil aksiyon butonu kullanılmalı.',
]: story.append(bullet(b))

story.append(h1('9. Flutter Teknik Öneriler'))
for b in [
    'State management: Riverpod veya Bloc. Küçük ekip için Riverpod daha hızlı ilerletir.',
    'Routing: go_router; rol bazlı route guard uygulanmalı.',
    'UI: ThemeData dark, custom ColorScheme; ortak AppScaffold, AppTopBar, BottomNav, StatCard, StatusBadge, FormSheet bileşenleri oluşturulmalı.',
    'Local cache: shared_preferences veya Hive/Isar; kurum/tenant ID anahtarına göre ayrım şart.',
    'API hazır değilse önce mock repository ile ekranlar tamamlanmalı; sonra repository katmanı REST/GraphQL’e bağlanmalı.',
    'Responsive: telefon öncelikli; tablet için iki kolonlu dashboard ve master-detail müşteri/randevu ekranı planlanmalı.',
]: story.append(bullet(b))

story.append(h1('10. Öncelikli MVP Sırası'))
for b in [
    '1) Login + rol seçimi + ortak tema/navigasyon.',
    '2) Personel: Bugün, Randevularım, Seanslarım, Müşterilerim.',
    '3) Admin: Dashboard, Müşteriler, Randevular, Paket/Hizmet, Kasa.',
    '4) Onaylar + Bildirimler + Loglar.',
    '5) Ön muhasebe, raporlar, stok ve ayarlar.',
    '6) Platform Admin ekranları.',
]: story.append(bullet(b))

# markdown copy
md = []
md.append('# BeautyAsist Flutter Mobil Uygulama Briefi\n')
md.append('Bu PDF web uygulaması dosyaları incelenerek hazırlanmıştır. Kaynak: `/home/kaya/projects/guzellik-frontend`.\n')
md.append('## Renkler\n- #160f13 ana arka plan\n- #24171d kart/hover yüzeyi\n- #fff2df krem yazı\n- #d7a373 altın vurgu\n- #f2b6c8 pudra vurgu\n- #a96b45 bakır\n')
for title, pages in [('Admin', admin_pages), ('Personel', personel_pages), ('Platform', platform_pages)]:
    md.append(f'## {title}\n')
    for p in pages:
        md.append(f'- **{p[0]}** `{p[1]}`: {p[2]} {p[3]}\n')
MD.write_text('\n'.join(md), encoding='utf-8')


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('DejaVu', 7)
    canvas.setFillColor(HexColor('#6f5960'))
    canvas.drawString(1.4*cm, 1.0*cm, 'BeautyAsist Flutter Mobil Brief')
    canvas.drawRightString(A4[0]-1.4*cm, 1.0*cm, str(doc.page))
    canvas.restoreState()

SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=1.25*cm, leftMargin=1.25*cm, topMargin=1.25*cm, bottomMargin=1.5*cm).build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
print(MD)
