import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';

/// "ŞİFREMİ UNUTTUM" — e-posta koduyla parola sıfırlama (web ForgotPasswordDialog paritesi).
///
/// Burası eskiden YOKTU: parolasını unutan kurum yöneticisi platform ekibini, personel ise
/// yöneticisini beklemek zorundaydı — gece yarısı panele giremeyen bir işletme için sabahı
/// beklemek demekti.
///
/// AKIŞ İKİ ADIM: e-posta → (kod + yeni parola). Kanal E-POSTADIR, SMS değil; e-posta zaten
/// giriş kimliğinin kendisidir ve panel girişinin ikinci faktörü de odur. SMS sağlayıcısı
/// canlıya alındığında bile bu akışın kanalı değişmez.
///
/// ENUMERASYON: sunucu, adres kayıtlı olsun olmasın AYNI yanıtı verir; bu ekran da öyle davranır.
/// "Böyle bir hesap yok" gibi bir mesaj HİÇBİR koşulda gösterilmez — kayıtsız adreste de kod
/// ekranı açılır, kod gelmez ve hiçbir kod doğrulanmaz.
///
/// KAPSAM: yalnız panel kullanıcıları (yönetici/personel). Müşterinin parolası yoktur; girişi
/// zaten e-posta koduyla yapılır.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({required this.auth, this.initialEmail, super.key});

  final AuthController auth;

  /// Giriş ekranında yazılı adres — kullanıcı aynı şeyi ikinci kez yazmasın.
  final String? initialEmail;

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

/// Sunucudaki kuralla AYNI (PasswordResetService.MinPasswordLength).
const int _minPassword = 8;

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final formKey = GlobalKey<FormState>();
  final emailController = TextEditingController();
  final codeController = TextEditingController();
  final passwordController = TextEditingController();

  /// Kod adımına geçildi mi? (Adım 1 → adım 2)
  bool codeStage = false;
  bool done = false;
  bool obscure = true;
  bool loading = false;
  String? error;

  String challengeId = '';
  String maskedEmail = '';
  String? devCode;

  @override
  void initState() {
    super.initState();
    emailController.text = widget.initialEmail?.trim() ?? '';
  }

  @override
  void dispose() {
    emailController.dispose();
    codeController.dispose();
    passwordController.dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    final mail = emailController.text.trim();
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(mail)) {
      setState(() => error = 'Geçerli bir e-posta adresi girin.');
      return;
    }
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final challenge = await widget.auth.passwordResetRequest(mail);
      if (!mounted) return;
      setState(() {
        codeStage = true;
        challengeId = challenge.challengeId;
        maskedEmail = challenge.maskedEmail;
        devCode = (challenge.devCode?.isEmpty ?? true) ? null : challenge.devCode;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _completeReset() async {
    final code = codeController.text.trim();
    if (code.length != 6) {
      setState(() => error = 'E-postanıza gelen 6 haneli kodu girin.');
      return;
    }
    if (passwordController.text.trim().length < _minPassword) {
      setState(() => error = 'Yeni parola en az $_minPassword karakter olmalı.');
      return;
    }
    setState(() {
      loading = true;
      error = null;
    });
    try {
      await widget.auth.passwordResetComplete(
        challengeId: challengeId,
        code: code,
        newPassword: passwordController.text.trim(),
      );
      if (mounted) setState(() => done = true);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: AppColors.ink,
        title: const Text('Şifremi unuttum'),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Form(
                key: formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: done ? _doneBody() : (codeStage ? _codeBody() : _emailBody()),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ adım 1

  List<Widget> _emailBody() => [
        _header(
          icon: Icons.lock_reset_rounded,
          title: 'Parolanızı sıfırlayın',
          subtitle:
              'Hesabınızın e-posta adresine 6 haneli bir doğrulama kodu göndereceğiz.',
        ),
        const SizedBox(height: 22),
        TextFormField(
          controller: emailController,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          textInputAction: TextInputAction.done,
          onFieldSubmitted: (_) => loading ? null : _requestCode(),
          decoration: const InputDecoration(
            labelText: 'Hesap e-postanız',
            prefixIcon: Icon(Icons.alternate_email_rounded),
          ),
        ),
        const SizedBox(height: 10),
        const Text(
          'Bu adresle birden fazla kurumda hesabınız varsa hepsinin parolası birlikte güncellenir.',
          style: TextStyle(color: AppColors.muted, fontSize: 12, height: 1.35),
        ),
        ..._errorBox(),
        const SizedBox(height: 18),
        _submitButton(
          label: 'Doğrulama Kodu Gönder',
          icon: Icons.mail_outline_rounded,
          onPressed: _requestCode,
        ),
        const SizedBox(height: 8),
        const Text(
          'Personelseniz kurum yöneticiniz de Personel sayfasından parolanızı sıfırlayabilir.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.muted, fontSize: 11.5, height: 1.35),
        ),
      ];

  // ------------------------------------------------------------------ adım 2

  List<Widget> _codeBody() => [
        _header(
          icon: Icons.password_rounded,
          title: 'Kodu girin',
          subtitle:
              '6 haneli kodu $maskedEmail adresine gönderdik. Kod 15 dakika geçerlidir.',
        ),
        const SizedBox(height: 22),
        TextFormField(
          controller: codeController,
          keyboardType: TextInputType.number,
          maxLength: 6,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w700,
            letterSpacing: 8,
            color: AppColors.ink,
          ),
          decoration: const InputDecoration(
            labelText: 'Doğrulama kodu',
            counterText: '',
            hintText: '000000',
          ),
        ),
        if (devCode != null) ...[
          const SizedBox(height: 2),
          Text(
            'Test ortamı kodu: $devCode',
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
          ),
        ],
        const SizedBox(height: 14),
        TextFormField(
          controller: passwordController,
          obscureText: obscure,
          decoration: InputDecoration(
            labelText: 'Yeni parola',
            helperText: 'En az $_minPassword karakter',
            prefixIcon: const Icon(Icons.lock_outline_rounded),
            suffixIcon: IconButton(
              onPressed: () => setState(() => obscure = !obscure),
              icon: Icon(obscure
                  ? Icons.visibility_outlined
                  : Icons.visibility_off_outlined),
            ),
          ),
        ),
        ..._errorBox(),
        const SizedBox(height: 18),
        _submitButton(
          label: 'Parolamı Güncelle',
          icon: Icons.check_rounded,
          onPressed: _completeReset,
        ),
        const SizedBox(height: 4),
        TextButton.icon(
          onPressed: loading
              ? null
              : () => setState(() {
                    codeStage = false;
                    codeController.clear();
                    error = null;
                  }),
          icon: const Icon(Icons.arrow_back_rounded, size: 18),
          label: const Text('E-postayı değiştir'),
        ),
      ];

  // ------------------------------------------------------------------ bitti

  List<Widget> _doneBody() => [
        _header(
          icon: Icons.verified_rounded,
          title: 'Parolanız güncellendi',
          subtitle:
              'Yeni parolanızla giriş yapabilirsiniz. Güvenlik için diğer tüm oturumlarınız kapatıldı.',
        ),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.success.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.success.withValues(alpha: 0.30)),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.shield_outlined, size: 18, color: AppColors.success),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Telefon, tablet ve masaüstündeki açık oturumlarınız kapatıldı. Parolanızı '
                  'başkası sıfırlattıysa bile eski erişimi sürmez.',
                  style: TextStyle(color: AppColors.ink, fontSize: 12, height: 1.35),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: () => context.go('/login'),
          icon: const Icon(Icons.login_rounded),
          label: const Text('Giriş ekranına dön'),
        ),
      ];

  // ------------------------------------------------------------------ parçalar

  Widget _header({
    required IconData icon,
    required String title,
    required String subtitle,
  }) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Icon(icon, color: AppColors.primary, size: 24),
          ),
          const SizedBox(height: 16),
          Text(
            title,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            subtitle,
            style: const TextStyle(color: AppColors.muted, fontSize: 13, height: 1.4),
          ),
        ],
      );

  List<Widget> _errorBox() {
    final message = error;
    if (message == null || message.isEmpty) return const [];
    return [
      const SizedBox(height: 14),
      Container(
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
      ),
    ];
  }

  Widget _submitButton({
    required String label,
    required IconData icon,
    required Future<void> Function() onPressed,
  }) =>
      FilledButton.icon(
        onPressed: loading ? null : () => onPressed(),
        icon: loading
            ? const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
              )
            : Icon(icon),
        label: Text(label),
      );
}
