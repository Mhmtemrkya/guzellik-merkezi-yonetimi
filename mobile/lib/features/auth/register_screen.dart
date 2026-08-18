import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/theme/app_theme.dart';

/// Kuruma bağlı olmayan müşteri kaydı (kayıt ol). Başarılı kayıt → otomatik giriş →
/// router müşteriyi /customer/home pazaryerine yönlendirir.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({required this.auth, super.key});
  final AuthController auth;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final formKey = GlobalKey<FormState>();
  final nameController = TextEditingController();
  final phoneController = TextEditingController();
  final emailController = TextEditingController();
  // İSTEĞE BAĞLI: doğum tarihi ve cinsiyet randevu almak için gerekmez, bu yüzden zorunlu
  // tutulamaz (App Store 5.1.1(v)). Cinsiyet varsayılanı "Belirtmek istemiyorum".
  DateTime? birthDate;
  int gender = 0; // 0 Belirtilmemiş (varsayılan), 1 Kadın, 2 Erkek, 3 Diğer
  bool loading = false;
  String? error;

  // Kayıt akışı iki adımlıdır: kod iste (otpStage=false) → kodu doğrula (otpStage=true).
  bool otpStage = false;
  String? otpInfo;
  final otpCodeController = TextEditingController();
  /// KVKK AÇIK RIZASI — kayıt için ZORUNLU. Sunucu da ayrıca doğrular (tek kapı istemci olamaz).
  bool kvkkConsent = false;

  @override
  void dispose() {
    nameController.dispose();
    phoneController.dispose();
    emailController.dispose();
    otpCodeController.dispose();
    super.dispose();
  }

  String? _birthStr() {
    final d = birthDate;
    if (d == null) return null;
    return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  Future<void> submit() async {
    if (!formKey.currentState!.validate()) return;
    // E-POSTA ZORUNLU. Giriş e-posta koduyla yapıldığı için adresi olmayan müşteri
    // kaydolduktan sonra hiç giriş yapamazdı.
    final mail = emailController.text.trim();
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(mail)) {
      setState(() => error = 'Geçerli bir e-posta girin — giriş kodunuz bu adrese gönderilecek.');
      return;
    }
    // KVKK açık rızası ZORUNLU. Kod göndermeden ÖNCE bakılır: onay vermeyecek kullanıcıya
    // boş yere SMS/e-posta göndermenin anlamı yok (hem maliyet hem gereksiz adım).
    if (!kvkkConsent) {
      setState(() => error = 'Devam etmek için KVKK aydınlatma metnini onaylamanız gerekir.');
      return;
    }
    setState(() {
      loading = true;
      error = null;
    });
    try {
      // KAYIT DA OTP'DEN GEÇER: hesap yalnız bir kanalın sahipliği kanıtlandıktan sonra açılır.
      if (!otpStage) {
        final res = await widget.auth.customerOtpRequest(
          fullName: nameController.text,
          phone: phoneController.text,
          purpose: 1,
          channel: CustomerOtpChannel.sms.code, // kayıt = SMS (sunucu da ezer)
          email: emailController.text,
        );
        final devCode = res['devCode'];
        final hint = res['hint']?.toString();
        if (mounted) {
          setState(() {
            otpStage = true;
            final base = devCode == null
                ? '6 haneli doğrulama kodunuz gönderildi. Kod 5 dakika geçerlidir.'
                : 'Doğrulama kodu gönderildi. (Test ortamı kodu: $devCode)';
            otpInfo = (hint == null || hint.isEmpty) ? base : '$base $hint';
          });
        }
        return;
      }

      final code = otpCodeController.text.trim();
      if (code.length != 6) {
        setState(() => error = 'Size gönderilen 6 haneli kodu girin.');
        return;
      }
      await widget.auth.customerOtpVerify(
        fullName: nameController.text,
        phone: phoneController.text,
        code: code,
        purpose: 1,
        gender: gender,
        email: emailController.text,
        birthDate: _birthStr(),
        kvkkConsent: kvkkConsent,
      );
      // Başarılıysa AuthController durumu signedIn olur ve router otomatik yönlendirir.
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  /// Kodu YENİDEN gönderir (kod adımında kalan kullanıcının çıkış yolu).
  ///
  /// Sunucuda taslak başına bekleme süresi ve gönderim sayısı sınırı vardır; sınıra takılırsa
  /// dönen mesaj kullanıcıya olduğu gibi gösterilir.
  Future<void> _resendCode() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final res = await widget.auth.customerOtpRequest(
        fullName: nameController.text,
        phone: phoneController.text,
        purpose: 1,
        channel: CustomerOtpChannel.sms.code, // kayıt = SMS (sunucu da ezer)
        email: emailController.text,
      );
      final devCode = res['devCode'];
      if (!mounted) return;
      setState(() {
        otpCodeController.clear();
        otpInfo = devCode == null
            ? 'Yeni doğrulama kodunuz gönderildi. Kod 5 dakika geçerlidir.'
            : 'Yeni doğrulama kodu gönderildi. (Test ortamı kodu: $devCode)';
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  /// KAYITTA KANAL SABİT: kod telefona SMS ile gider.
  ///
  /// Amaç numaranın gerçekten kişiye ait olduğunu kanıtlamak — hesap bu numarayla açılıyor ve
  /// randevu bildirimleri oraya gidiyor. Girişte ise kod e-postaya gider (her girişte SMS
  /// harcanmaz). Kural sunucuda da zorlanır; burada yalnızca anlatılır.
  List<Widget> _channelNotice() => [
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.sms_outlined, size: 18, color: AppColors.primaryDark),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Doğrulama kodu telefonunuza SMS ile gönderilecek.',
                  style: TextStyle(color: AppColors.muted, fontSize: 12, height: 1.35),
                ),
              ),
            ],
          ),
        ),
      ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset(
            'assets/images/login-background.png',
            fit: BoxFit.cover,
            color: Colors.white.withValues(alpha: .08),
            colorBlendMode: BlendMode.srcOver,
            errorBuilder: (_, _, _) => const SizedBox.shrink(),
          ),
          Container(color: Colors.white.withValues(alpha: .36)),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 430),
                  child: Card(
                    color: Colors.white.withValues(alpha: .94),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(22, 24, 22, 24),
                      child: Form(
                        key: formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                IconButton(
                                  onPressed: () =>
                                      context.canPop() ? context.pop() : context.go('/login'),
                                  icon: const Icon(Icons.arrow_back_rounded),
                                  tooltip: 'Geri',
                                ),
                                const SizedBox(width: 4),
                                Expanded(
                                  child: Text(
                                    'Hesap Oluştur',
                                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                          fontWeight: FontWeight.w800,
                                          letterSpacing: -.7,
                                        ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            const Text(
                              'Kaydolun ve dilediğiniz güzellik merkezinden online randevu alın.',
                              style: TextStyle(color: AppColors.muted),
                            ),
                            const SizedBox(height: 22),
                            TextFormField(
                              controller: nameController,
                              textCapitalization: TextCapitalization.words,
                              validator: (v) =>
                                  (v ?? '').trim().isEmpty ? 'Ad soyad zorunlu.' : null,
                              decoration: const InputDecoration(
                                labelText: 'Ad Soyad',
                                prefixIcon: Icon(Icons.badge_outlined),
                              ),
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: phoneController,
                              keyboardType: TextInputType.phone,
                              validator: (v) {
                                final digits = (v ?? '').replaceAll(RegExp(r'\D'), '');
                                return digits.length >= 10 ? null : 'Geçerli bir telefon girin.';
                              },
                              decoration: const InputDecoration(
                                labelText: 'Telefon',
                                hintText: '0555 123 45 67',
                                prefixIcon: Icon(Icons.phone_outlined),
                              ),
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: emailController,
                              keyboardType: TextInputType.emailAddress,
                              autocorrect: false,
                              validator: (v) {
                                final t = (v ?? '').trim();
                                // ARTIK OPSİYONEL DEĞİL: giriş kodu bu adrese gidiyor.
                                if (t.isEmpty) return 'E-posta zorunlu (giriş kodu buraya gelir).';
                                return t.contains('@') && t.contains('.')
                                    ? null
                                    : 'Geçerli bir e-posta girin.';
                              },
                              decoration: const InputDecoration(
                                // ZORUNLU: bir sonraki GİRİŞTE kod bu adrese gidecek.
                                labelText: 'E-posta (giriş kodu buraya gelecek)',
                                prefixIcon: Icon(Icons.mail_outline_rounded),
                              ),
                            ),
                            // Kod nereye gidecek? (Kayıt = SMS; kural sunucuda zorlanır.)
                            if (!otpStage) ..._channelNotice(),
                            // --- İSTEĞE BAĞLI PROFİL BİLGİLERİ ---
                            // Randevu almak için gerekmediklerinden ZORUNLU DEĞİL (App Store 5.1.1(v)).
                            const SizedBox(height: 16),
                            const Text(
                              'İsteğe bağlı — doğum günü kutlamaları ve size uygun kampanyalar için',
                              style: TextStyle(fontSize: 11.5, color: AppColors.muted, height: 1.35),
                            ),
                            const SizedBox(height: 8),
                            InkWell(
                              onTap: () async {
                                final now = DateTime.now();
                                final picked = await showDatePicker(
                                  context: context,
                                  firstDate: DateTime(now.year - 100),
                                  lastDate: now,
                                  initialDate: birthDate ?? DateTime(now.year - 25),
                                );
                                if (picked != null) setState(() => birthDate = picked);
                              },
                              child: InputDecorator(
                                decoration: InputDecoration(
                                  labelText: 'Doğum Tarihi (isteğe bağlı)',
                                  prefixIcon: const Icon(Icons.cake_outlined),
                                  // Girilen tarihi geri almanın yolu olsun: seçim tek yönlü kalmasın.
                                  suffixIcon: birthDate == null
                                      ? null
                                      : IconButton(
                                          tooltip: 'Temizle',
                                          onPressed: () => setState(() => birthDate = null),
                                          icon: const Icon(Icons.close_rounded, size: 18),
                                        ),
                                ),
                                child: Text(
                                  birthDate == null
                                      ? 'Belirtmek istemiyorum'
                                      : '${birthDate!.day.toString().padLeft(2, '0')}.${birthDate!.month.toString().padLeft(2, '0')}.${birthDate!.year}',
                                  style: TextStyle(
                                    color: birthDate == null ? AppColors.muted : AppColors.ink,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            const Text('Cinsiyet (isteğe bağlı)',
                                style: TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.muted)),
                            const SizedBox(height: 6),
                            SegmentedButton<int>(
                              segments: const [
                                ButtonSegment(value: 0, label: Text('Belirtmiyorum')),
                                ButtonSegment(value: 1, label: Text('Kadın')),
                                ButtonSegment(value: 2, label: Text('Erkek')),
                              ],
                              selected: {gender == 3 ? 0 : gender},
                              showSelectedIcon: false,
                              onSelectionChanged: (s) => setState(() => gender = s.first),
                            ),
                            // KVKK AÇIK RIZASI — ZORUNLU. Eskiden hiçbir ekran onay sormuyordu
                            // ama kayıt veritabanına "onay verildi" yazıyordu. Onay hukuki bir
                            // beyandır: alınmadan üretilemez. Sunucu da ayrıca doğrular.
                            if (!otpStage) ...[
                              const SizedBox(height: 16),
                              InkWell(
                                onTap: () => setState(() {
                                  kvkkConsent = !kvkkConsent;
                                  error = null;
                                }),
                                borderRadius: BorderRadius.circular(14),
                                child: Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: AppColors.surfaceSoft,
                                    borderRadius: BorderRadius.circular(14),
                                    border: Border.all(
                                      color: kvkkConsent ? AppColors.primary : AppColors.border,
                                    ),
                                  ),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      SizedBox(
                                        width: 22,
                                        height: 22,
                                        child: Checkbox(
                                          value: kvkkConsent,
                                          onChanged: (v) => setState(() {
                                            kvkkConsent = v ?? false;
                                            error = null;
                                          }),
                                          activeColor: AppColors.primary,
                                          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                          visualDensity: VisualDensity.compact,
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      const Expanded(
                                        child: Text(
                                          'KVKK aydınlatma metnini okudum; kişisel verilerimin '
                                          'randevu işlemlerim için işlenmesine onay veriyorum.',
                                          style: TextStyle(
                                            fontSize: 12,
                                            height: 1.35,
                                            color: AppColors.ink,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                            // Adım 2: gelen kod. Hesap yalnız kod doğrulanınca açılır.
                            if (otpStage) ...[
                              const SizedBox(height: 12),
                              TextFormField(
                                controller: otpCodeController,
                                keyboardType: TextInputType.number,
                                maxLength: 6,
                                decoration: const InputDecoration(
                                  labelText: 'Doğrulama kodu',
                                  prefixIcon: Icon(Icons.verified_outlined),
                                  counterText: '',
                                ),
                              ),
                              if (otpInfo != null)
                                Text(
                                  otpInfo!,
                                  style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                                ),
                              // KOD GELMEZSE ÇIKIŞ YOLU. Kod adımında ne "tekrar gönder" ne de
                              // "geri dön" vardı: yanlış yazılmış bir numarayla kalan kullanıcı
                              // ekranı kapatıp baştan başlamak zorunda kalıyordu.
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  TextButton(
                                    onPressed: loading
                                        ? null
                                        : () => setState(() {
                                            otpStage = false;
                                            otpInfo = null;
                                            otpCodeController.clear();
                                            error = null;
                                          }),
                                    child: const Text('← Bilgileri düzenle'),
                                  ),
                                  TextButton(
                                    onPressed: loading ? null : _resendCode,
                                    child: const Text('Kodu tekrar gönder'),
                                  ),
                                ],
                              ),
                            ],
                            if (error != null) ...[
                              const SizedBox(height: 12),
                              Text(
                                error!,
                                style: const TextStyle(
                                  color: AppColors.danger,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                            const SizedBox(height: 20),
                            FilledButton.icon(
                              onPressed: loading ? null : submit,
                              icon: loading
                                  ? const SizedBox.square(
                                      dimension: 18,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2, color: Colors.white),
                                    )
                                  : Icon(otpStage ? Icons.check_rounded : Icons.sms_rounded),
                              label: Text(otpStage
                                  ? 'Kodu Doğrula ve Kaydı Tamamla'
                                  : 'Doğrulama Kodu Gönder'),
                            ),
                            const SizedBox(height: 8),
                            Center(
                              child: TextButton(
                                onPressed: loading
                                    ? null
                                    : () => context.canPop() ? context.pop() : context.go('/login'),
                                child: const Text('Zaten hesabın var mı? Giriş yap'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
