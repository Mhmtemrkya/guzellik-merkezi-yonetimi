import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// "Bu ekran nasıl çalışır?" — randevu formunun kullanım kılavuzu (web
/// AppointmentHelpDialog paritesi). Altın kural en üstte: randevu seanstan açılır,
/// seans da satıştan doğar; seansı olmayan hizmet ücretli randevu olur.
class AppointmentHelpSheet extends StatelessWidget {
  const AppointmentHelpSheet({super.key});

  static Future<void> show(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => const AppointmentHelpSheet(),
  );

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, controller) => ListView(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
        children: [
          Row(
            children: [
              const Icon(Icons.help_outline_rounded, color: AppColors.primary),
              const SizedBox(width: 10),
              const Expanded(
                child: Text(
                  'Bu ekran nasıl çalışır?',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
              ),
              IconButton(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'Randevu açmanın sırası, kuralları ve sık takılınan noktalar.',
            style: TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: 16),

          // ALTIN KURAL
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF6F9),
              border: Border.all(color: const Color(0xFFE8C2D1)),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.shopping_bag_rounded, size: 16, color: Color(0xFF8E3F5B)),
                    SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Altın kural: seans satıştan doğar',
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF8E3F5B),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                const Text(
                  'Müşteri hizmeti ya da paketi satın aldığında seans hakkı oluşur. Seansı olan bir '
                  'hizmetten randevu açarsan randevu ücretsiz sayılır ve tamamlandığında 1 seans düşer.',
                  style: TextStyle(fontSize: 12.5, height: 1.45),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Seansı olmayan bir hizmet seçersen randevu iptal olmaz — katalog fiyatıyla ÜCRETLİ '
                  'açılır. Paketten düşmesini istiyorsan önce aşağıdaki "Hizmet sat" / "Paket sat" ile '
                  'satışı yap, sonra randevuyu aç.',
                  style: TextStyle(fontSize: 12.5, height: 1.45),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),

          const Text(
            'Adım adım',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          const _HelpStep(
            n: 1,
            icon: Icons.person_rounded,
            title: 'Müşteri',
            body:
                'Ad ya da telefonla ara. Kayıtlı değilse sağdaki + ile buradan ekle, otomatik seçilir. '
                'Seçince altında dosyası açılır: borcu, satışları, kalan seansları ve geçmişi.',
          ),
          const _HelpStep(
            n: 2,
            icon: Icons.content_cut_rounded,
            title: 'Hizmet',
            body:
                'Katalogdaki hizmeti seç. Süre hizmetin varsayılanından gelir. Müşterinin o hizmette '
                'kalan seansı varsa randevu paketten karşılanır, yoksa ücretli açılır.',
          ),
          const _HelpStep(
            n: 3,
            icon: Icons.badge_rounded,
            title: 'Personel',
            body:
                'Yalnız o hizmetin kategorisinde yetkili personel listelenir. Listede aradığın kişi '
                'yoksa personel kartından yetki vermen gerekir.',
          ),
          const _HelpStep(
            n: 4,
            icon: Icons.schedule_rounded,
            title: 'Tarih ve saat',
            body:
                'Saat seç ve kaydet. Personelin izinli olduğu gün ya da "Gün Kapat" ile kapatılmış '
                'saat aralığı seçilemez.',
          ),
          const SizedBox(height: 18),

          const Text(
            'Sık takılınan noktalar',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          const _HelpTip(
            icon: Icons.hourglass_bottom_rounded,
            title: 'Saat dolu',
            body:
                'Bir personelin aynı aralıkta en fazla 2 randevusu olabilir. Dolu saatte ekran seni '
                'bekleme listesine eklemeyi önerir; yer açılınca müşteriye WhatsApp\'tan teklif gider.',
          ),
          const _HelpTip(
            icon: Icons.lock_clock_rounded,
            title: 'Personel izinli / saat kapalı',
            body:
                'O gün ya da o saat aralığı randevuya kapatılmıştır. Farklı saat, gün veya personel seç.',
          ),
          const _HelpTip(
            icon: Icons.payments_rounded,
            title: 'Müşterinin borcu var',
            body:
                '"Tahsilat al" ile randevudan çıkmadan tahsil edebilirsin; ödeme en eski vadeden '
                'başlayarak taksitlere dağıtılır.',
          ),
          const _HelpTip(
            icon: Icons.timer_rounded,
            title: 'Seans ne zaman düşer?',
            body:
                'Randevu açılınca değil, "Tamamlandı" yapılınca. İptal edilen randevu seansı tüketmez.',
          ),
          const SizedBox(height: 16),

          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFFDF9FB),
              border: Border.all(color: const Color(0xFFE8D5DE)),
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Personel olarak açıyorsan',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
                ),
                SizedBox(height: 6),
                Text(
                  'Randevu taslak olarak kaydedilir ve kurum yöneticisinin onayına düşer. Yalnızca '
                  'kendi takvimine randevu açabilirsin.',
                  style: TextStyle(fontSize: 12.5, height: 1.45),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Anladım'),
          ),
        ],
      ),
    );
  }
}

class _HelpStep extends StatelessWidget {
  const _HelpStep({
    required this.n,
    required this.icon,
    required this.title,
    required this.body,
  });
  final int n;
  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 28,
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: const Color(0xFFFFF4F8),
            border: Border.all(color: const Color(0xFFE8C2D1)),
            shape: BoxShape.circle,
          ),
          child: Text(
            '$n',
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w800,
              color: Color(0xFF8E3F5B),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, size: 15, color: const Color(0xFFC7768F)),
                  const SizedBox(width: 6),
                  Text(
                    title,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
              const SizedBox(height: 3),
              Text(body, style: const TextStyle(fontSize: 12.5, height: 1.45)),
            ],
          ),
        ),
      ],
    ),
  );
}

class _HelpTip extends StatelessWidget {
  const _HelpTip({required this.icon, required this.title, required this.body});
  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: const Color(0xFFEFE1E7)),
      borderRadius: BorderRadius.circular(14),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 15, color: const Color(0xFFC7768F)),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
        const SizedBox(height: 3),
        Text(body, style: const TextStyle(fontSize: 12, height: 1.45)),
      ],
    ),
  );
}
