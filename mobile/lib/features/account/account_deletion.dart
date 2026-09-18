import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';

/// HESAP SİLME kartları — "Hesabımı sil" (web components/account paritesi).
///
/// İKİ AYRI HESAP TÜRÜ, İKİ AYRI ANLAM:
/// * [TenantDeletionCard]   — kurum yöneticisi; kurumu ve tüm verisini siler. Bekleme süreli,
///   süre dolana kadar GERİ ALINABİLİR.
/// * [CustomerDeletionCard] — portal müşterisi; kişisel verisini siler. ANINDA, geri alınamaz.
///
/// App Store 5.1.1(v): hesabı oluşturmaya izin veren uygulama, hesabın SİLİNMESİNE de uygulama
/// İÇİNDEN izin vermek zorundadır. Kullanıcıyı "web sitemizden silin" diye dışarı yollamak
/// reddedilme sebebidir; bu yüzden kartlar mobilde de tam işlevlidir.
///
/// PERSONEL KAPSAM DIŞIDIR: personel hesabı kişinin kendi hesabı değil KURUMUN açtığı bir
/// erişimdir; kapatma yetkisi de kurumdadır (Personel sayfası). Sunucu da bu kuralı zorlar.

// =============================================================================== ortak kabuk

/// TEHLİKELİ İŞLEM KABUĞU — geri alınamaz işlemlerin ortak çerçevesi.
///
/// Ayrı durması görsel değil DAVRANIŞSAL bir karardır: blok, ayarların geri kalanından ayrı
/// durur ve hiçbir zaman "kaydet" akışının parçası olmaz. Silme düğmesini sıradan ayarların
/// arasına koymak, kaydet refleksiyle basılmasına davetiye çıkarırdı.
class DangerZone extends StatelessWidget {
  const DangerZone({
    required this.title,
    required this.description,
    required this.child,
    super.key,
  });

  final String title;
  final String description;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.danger.withValues(alpha: 0.06),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(21)),
              border: Border(
                bottom: BorderSide(color: AppColors.danger.withValues(alpha: 0.25)),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.warning_amber_rounded, size: 20, color: AppColors.danger),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                          color: AppColors.danger,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        description,
                        style: const TextStyle(fontSize: 12, height: 1.35, color: AppColors.ink),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(padding: const EdgeInsets.all(16), child: child),
        ],
      ),
    );
  }
}

/// Hata kutusu — iki kartın da kullandığı tek biçim.
Widget _errorBox(String message) => Container(
      margin: const EdgeInsets.only(top: 14),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.danger.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.30)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline_rounded, size: 18, color: AppColors.danger),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: AppColors.danger, fontSize: 12.5, height: 1.35),
            ),
          ),
        ],
      ),
    );

/// Uyarı kutusu (amber) — "geri alınamaz" ihtarı.
Widget _warnBox(String message) => Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.gpp_maybe_rounded, size: 18, color: AppColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: AppColors.ink, fontSize: 12, height: 1.4),
            ),
          ),
        ],
      ),
    );

/// Sunucudan UTC gelir; kullanıcıya YEREL tarih gösterilir.
String _formatDate(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return '—';
  final d = parsed.toLocal();
  const months = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
  ];
  return '${d.day.toString().padLeft(2, '0')} ${months[d.month - 1]} ${d.year}';
}

// =============================================================================== KURUM

/// KURUM HESABINI SİL — bekleme süreli, geri alınabilir.
///
/// ÜÇ KAPI: parola (oturumun değil HESABIN sahibi olduğunu kanıtlar), elle yazılan kurum kodu
/// (refleksle basılamaz) ve ekranda açıkça yazan silinme tarihi. "Emin misiniz?" diyen tek bir
/// kutu, geri alınamaz bir işlem için yeterli bir eşik değildir.
class TenantDeletionCard extends StatefulWidget {
  const TenantDeletionCard({required this.auth, super.key});
  final AuthController auth;

  @override
  State<TenantDeletionCard> createState() => _TenantDeletionCardState();
}

class _TenantDeletionCardState extends State<TenantDeletionCard> {
  final passwordController = TextEditingController();
  final confirmController = TextEditingController();
  final reasonController = TextEditingController();

  Map<String, dynamic>? status;
  bool loading = true;
  bool busy = false;
  bool open = false;
  bool obscure = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    passwordController.dispose();
    confirmController.dispose();
    reasonController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await widget.auth.api.get('/api/account/tenant/deletion');
      if (mounted) setState(() => status = (data as Map).cast<String, dynamic>());
    } catch (_) {
      // Uç okunamazsa (ör. rol yetmiyor) kart hiç gösterilmez — bozuk bir kutu göstermektense.
      if (mounted) setState(() => status = null);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _submit() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = await widget.auth.api.post('/api/account/tenant/deletion', {
        'password': passwordController.text,
        'confirmation': confirmController.text.trim(),
        'reason': reasonController.text.trim().isEmpty ? null : reasonController.text.trim(),
      });
      if (!mounted) return;
      setState(() {
        status = (data as Map).cast<String, dynamic>();
        open = false;
        passwordController.clear();
        confirmController.clear();
        reasonController.clear();
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _cancel() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = await widget.auth.api.delete('/api/account/tenant/deletion');
      if (mounted) setState(() => status = (data as Map).cast<String, dynamic>());
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const SizedBox.shrink();
    final s = status;
    if (s == null) return const SizedBox.shrink();

    return s['pending'] == true ? _pending(s) : _idle(s);
  }

  // ------------------------------------------------------- talep var: geri sayım + iptal
  Widget _pending(Map<String, dynamic> s) => DangerZone(
        title: 'Hesap silme talebiniz işleniyor',
        description:
            'Bekleme süresi dolduğunda kurumunuz ve tüm verisi kalıcı olarak silinir. '
            'Fikrinizi değiştirdiyseniz talebi şimdi geri alabilirsiniz.',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.event_busy_rounded, size: 20, color: AppColors.danger),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Silinme tarihi: ${_formatDate(s['scheduledAtUtc']?.toString())}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                            color: AppColors.ink,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          'Talep ${_formatDate(s['requestedAtUtc']?.toString())} tarihinde oluşturuldu.',
                          style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'O tarihe kadar uygulamayı normal şekilde kullanabilirsiniz. Verilerinizi '
              'Raporlar sayfasından dışa aktarabilirsiniz.',
              style: TextStyle(fontSize: 12, height: 1.4, color: AppColors.muted),
            ),
            if (error != null) _errorBox(error!),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: busy ? null : _cancel,
              icon: busy
                  ? const SizedBox.square(
                      dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.undo_rounded, size: 18),
              label: const Text('Silme talebini geri al'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.success,
                side: BorderSide(color: AppColors.success.withValues(alpha: 0.45)),
              ),
            ),
          ],
        ),
      );

  // ------------------------------------------------------- talep yok: silme akışı
  Widget _idle(Map<String, dynamic> s) {
    final graceDays = (s['graceDays'] as num?)?.toInt() ?? 30;
    final phrase = '${s['confirmationPhrase'] ?? ''}';

    return DangerZone(
      title: 'Hesabımı sil',
      description:
          'Kurumunuzu ve tüm verisini (müşteriler, randevular, satışlar, tahsilatlar, raporlar '
          've personel hesapları) kalıcı olarak siler. Talebiniz $graceDays gün sonra uygulanır; '
          'bu süre içinde vazgeçebilirsiniz.',
      child: !open
          ? OutlinedButton.icon(
              onPressed: () => setState(() => open = true),
              icon: const Icon(Icons.delete_outline_rounded, size: 18),
              label: const Text('Hesabımı silmek istiyorum'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.danger,
                side: BorderSide(color: AppColors.danger.withValues(alpha: 0.45)),
              ),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _warnBox(
                  'Bu işlem geri alınamaz. Silme gerçekleştikten sonra verileriniz hiçbir '
                  'yedekten geri getirilemez ve personel hesaplarınız da kapanır.',
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: passwordController,
                  obscureText: obscure,
                  decoration: InputDecoration(
                    labelText: 'Parolanız',
                    prefixIcon: const Icon(Icons.lock_outline_rounded),
                    suffixIcon: IconButton(
                      onPressed: () => setState(() => obscure = !obscure),
                      icon: Icon(obscure
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: confirmController,
                  decoration: InputDecoration(
                    labelText: 'Onay için "$phrase" yazın',
                    hintText: phrase,
                    prefixIcon: const Icon(Icons.edit_outlined),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: reasonController,
                  maxLength: 500,
                  decoration: const InputDecoration(
                    labelText: 'Gerekçe (isteğe bağlı)',
                    counterText: '',
                    prefixIcon: Icon(Icons.chat_bubble_outline_rounded),
                  ),
                ),
                if (error != null) _errorBox(error!),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: busy ? null : _submit,
                        icon: busy
                            ? const SizedBox.square(
                                dimension: 16,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white))
                            : const Icon(Icons.check_rounded, size: 18),
                        label: const Text('Talebi onayla'),
                        style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
                      ),
                    ),
                    const SizedBox(width: 10),
                    OutlinedButton(
                      onPressed: busy
                          ? null
                          : () => setState(() {
                                open = false;
                                error = null;
                                passwordController.clear();
                                confirmController.clear();
                                reasonController.clear();
                              }),
                      child: const Text('Vazgeç'),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
}

// =============================================================================== MÜŞTERİ

/// Müşterinin onay kutusuna yazması gereken metin (sunucudaki sabitle AYNI).
const String customerDeletePhrase = 'SİL';

/// HESABIMI SİL — online randevu portalı müşterisi.
///
/// Kurumdan farklı olarak ANINDA uygulanır: müşteri hesabı kişisel bir hesaptır, ardında
/// işletilmesi gereken bir muhasebe ya da personel yapısı yoktur. Beklemek, kişinin kendi
/// verisinin silinmesini geciktirmekten başka işe yaramazdı.
///
/// SALONUN KENDİ KAYDI KAPSAM DIŞIDIR ve bu ekranda AÇIKÇA yazar: randevu alınan güzellik
/// merkezi kendi müşteri defterinin veri sorumlusudur. Gizlemek, "her şey silindi" sanan bir
/// kullanıcı bırakırdı.
///
/// PAROLA SORULMAZ, çünkü müşteri hesabında parola YOKTUR (giriş e-posta koduyla yapılır).
/// Niyetin tek kanıtı elle yazılan onay metnidir; sunucu da aynı metni arar.
class CustomerDeletionCard extends StatefulWidget {
  const CustomerDeletionCard({required this.auth, super.key});
  final AuthController auth;

  @override
  State<CustomerDeletionCard> createState() => _CustomerDeletionCardState();
}

class _CustomerDeletionCardState extends State<CustomerDeletionCard> {
  final confirmController = TextEditingController();
  final reasonController = TextEditingController();

  bool open = false;
  bool busy = false;
  String? error;

  @override
  void dispose() {
    confirmController.dispose();
    reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.auth.api.post('/api/account/customer/deletion', {
        'confirmation': confirmController.text.trim(),
        'reason': reasonController.text.trim().isEmpty ? null : reasonController.text.trim(),
      });
      if (!mounted) return;
      // localOnly: sunucu oturumu ZATEN kapattı (refresh token'lar iptal edildi). Ayrıca
      // /logout çağırmak, artık geçersiz olan bir jetonla 401 alıp akışı hata dalına
      // düşürürdü — kullanıcı hesabı silinmişken "çıkış yapılamadı" hatası görürdü.
      await widget.auth.signOut(localOnly: true);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Hesabınız silindi.')),
      );
      context.go('/login');
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          error = e.message;
          busy = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          error = '$e';
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DangerZone(
      title: 'Hesabımı sil',
      description:
          'Hesabınızı ve kişisel bilgilerinizi (ad, telefon, e-posta, doğum tarihi, notlar) '
          'kalıcı olarak siler.',
      child: !open
          ? OutlinedButton.icon(
              onPressed: () => setState(() => open = true),
              icon: const Icon(Icons.delete_outline_rounded, size: 18),
              label: const Text('Hesabımı sil'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.danger,
                side: BorderSide(color: AppColors.danger.withValues(alpha: 0.45)),
              ),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _warnBox(
                  'Bu işlem anında uygulanır ve geri alınamaz. Hesabınız kapanır, bir daha giriş '
                  'yapamazsınız. Randevu aldığınız güzellik merkezinin kendi müşteri '
                  'kayıtlarındaki bilgileriniz için doğrudan o merkeze başvurmanız gerekir.',
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: confirmController,
                  decoration: const InputDecoration(
                    labelText: 'Onay için "$customerDeletePhrase" yazın',
                    hintText: customerDeletePhrase,
                    prefixIcon: Icon(Icons.edit_outlined),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: reasonController,
                  maxLength: 500,
                  decoration: const InputDecoration(
                    labelText: 'Gerekçe (isteğe bağlı)',
                    counterText: '',
                    prefixIcon: Icon(Icons.chat_bubble_outline_rounded),
                  ),
                ),
                if (error != null) _errorBox(error!),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: busy ? null : _submit,
                        icon: busy
                            ? const SizedBox.square(
                                dimension: 16,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white))
                            : const Icon(Icons.check_rounded, size: 18),
                        label: const Text('Kalıcı olarak sil'),
                        style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
                      ),
                    ),
                    const SizedBox(width: 10),
                    OutlinedButton(
                      onPressed: busy
                          ? null
                          : () => setState(() {
                                open = false;
                                error = null;
                                confirmController.clear();
                                reasonController.clear();
                              }),
                      child: const Text('Vazgeç'),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
}
