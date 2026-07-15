import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/theme/app_theme.dart';

/// İlk girişte zorunlu şifre değiştirme ekranı (web /change-password paritesi).
/// Geçici şifreyle giriş yapan kullanıcı buraya yönlendirilir; "Daha Sonra"
/// ile bu oturum için atlanabilir, bir sonraki girişte tekrar sorulur.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({required this.auth, super.key});
  final AuthController auth;

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final formKey = GlobalKey<FormState>();
  final currentController = TextEditingController();
  final newController = TextEditingController();
  final confirmController = TextEditingController();

  bool obscureCurrent = true;
  bool obscureNew = true;
  bool obscureConfirm = true;
  bool loading = false;
  String? error;

  @override
  void dispose() {
    currentController.dispose();
    newController.dispose();
    confirmController.dispose();
    super.dispose();
  }

  // Web ile aynı gereksinimler: 8+ karakter, küçük, büyük, rakam + özel.
  bool get reqLength => newController.text.length >= 8;
  bool get reqLower => RegExp(r'[a-z]').hasMatch(newController.text);
  bool get reqUpper => RegExp(r'[A-Z]').hasMatch(newController.text);
  bool get reqNumSpecial =>
      RegExp(r'\d').hasMatch(newController.text) &&
      RegExp(r'[^A-Za-z0-9]').hasMatch(newController.text);
  bool get allOk => reqLength && reqLower && reqUpper && reqNumSpecial;

  Future<void> submit() async {
    setState(() => error = null);
    if (!formKey.currentState!.validate()) return;
    if (!allOk) {
      setState(() => error = 'Yeni şifre aşağıdaki tüm güvenlik koşullarını karşılamalıdır.');
      return;
    }
    if (newController.text != confirmController.text) {
      setState(() => error = 'Yeni şifre tekrarı uyuşmuyor.');
      return;
    }
    if (currentController.text == newController.text) {
      setState(() => error = 'Yeni şifre, geçici şifreyle aynı olamaz.');
      return;
    }
    setState(() => loading = true);
    try {
      await widget.auth.changePassword(
        currentPassword: currentController.text,
        newPassword: newController.text,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Şifren değiştirildi.')),
      );
      context.go('/home');
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void skip() {
    widget.auth.skipPasswordChange();
    context.go('/home');
  }

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
                  constraints: const BoxConstraints(maxWidth: 460),
                  child: Card(
                    color: Colors.white.withValues(alpha: .95),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(22, 26, 22, 24),
                      child: Form(
                        key: formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Center(
                              child: CircleAvatar(
                                radius: 28,
                                backgroundColor: AppColors.rose,
                                child: Icon(Icons.lock_reset_rounded,
                                    size: 30, color: AppColors.primaryDark),
                              ),
                            ),
                            const SizedBox(height: 18),
                            const Text(
                              'İLK GİRİŞ',
                              style: TextStyle(
                                color: AppColors.primaryDark,
                                fontWeight: FontWeight.w800,
                                fontSize: 10,
                                letterSpacing: 2.4,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Şifreni Değiştir',
                              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: -.7,
                                  ),
                            ),
                            const SizedBox(height: 6),
                            const Text(
                              'Güvenliğin için, sisteme devam edebilmek adına geçici şifreni yenisiyle değiştirmen gerekiyor.',
                              style: TextStyle(color: AppColors.muted, fontSize: 13, height: 1.35),
                            ),
                            const SizedBox(height: 18),
                            // E-posta (salt okunur)
                            InputDecorator(
                              decoration: const InputDecoration(
                                labelText: 'E-posta',
                                prefixIcon: Icon(Icons.mail_outline_rounded),
                              ),
                              child: Text(
                                widget.auth.user?.email ?? '',
                                style: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w600),
                              ),
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: currentController,
                              obscureText: obscureCurrent,
                              autofocus: true,
                              validator: (v) => (v ?? '').isEmpty ? 'Mevcut (geçici) şifre zorunlu.' : null,
                              decoration: InputDecoration(
                                labelText: 'Mevcut (Geçici) Şifre',
                                prefixIcon: const Icon(Icons.key_rounded),
                                suffixIcon: IconButton(
                                  onPressed: () => setState(() => obscureCurrent = !obscureCurrent),
                                  icon: Icon(obscureCurrent
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined),
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: newController,
                              obscureText: obscureNew,
                              onChanged: (_) => setState(() {}),
                              validator: (v) => (v ?? '').length < 8 ? 'En az 8 karakter olmalı.' : null,
                              decoration: InputDecoration(
                                labelText: 'Yeni Şifre',
                                prefixIcon: const Icon(Icons.shield_outlined),
                                suffixIcon: IconButton(
                                  onPressed: () => setState(() => obscureNew = !obscureNew),
                                  icon: Icon(obscureNew
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined),
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: confirmController,
                              obscureText: obscureConfirm,
                              onChanged: (_) => setState(() {}),
                              onFieldSubmitted: (_) => submit(),
                              validator: (v) => (v ?? '').isEmpty ? 'Yeni şifre tekrarı zorunlu.' : null,
                              decoration: InputDecoration(
                                labelText: 'Yeni Şifre (Tekrar)',
                                prefixIcon: const Icon(Icons.shield_outlined),
                                errorText: confirmController.text.isNotEmpty &&
                                        newController.text != confirmController.text
                                    ? 'Şifreler uyuşmuyor.'
                                    : null,
                                suffixIcon: IconButton(
                                  onPressed: () => setState(() => obscureConfirm = !obscureConfirm),
                                  icon: Icon(obscureConfirm
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined),
                                ),
                              ),
                            ),
                            const SizedBox(height: 14),
                            // Gereksinim listesi (web paritesi)
                            Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: AppColors.surfaceSoft,
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: AppColors.border),
                              ),
                              child: Column(
                                children: [
                                  _requirement(reqLength, 'En az 8 karakter'),
                                  _requirement(reqLower, 'En az 1 küçük harf'),
                                  _requirement(reqUpper, 'En az 1 büyük harf'),
                                  _requirement(reqNumSpecial, 'En az 1 rakam ve 1 özel karakter'),
                                ],
                              ),
                            ),
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
                            const SizedBox(height: 18),
                            Row(
                              children: [
                                Expanded(
                                  child: OutlinedButton.icon(
                                    onPressed: loading ? null : skip,
                                    icon: const Icon(Icons.schedule_rounded, size: 18),
                                    label: const Text('Daha Sonra'),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  flex: 2,
                                  child: FilledButton.icon(
                                    onPressed: loading ? null : submit,
                                    icon: loading
                                        ? const SizedBox.square(
                                            dimension: 18,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                              color: Colors.white,
                                            ),
                                          )
                                        : const Icon(Icons.lock_rounded, size: 18),
                                    label: Text(loading ? 'Kaydediliyor' : 'Şifreyi Değiştir'),
                                  ),
                                ),
                              ],
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

  Widget _requirement(bool ok, String label) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          children: [
            Icon(
              ok ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
              size: 18,
              color: ok ? AppColors.success : AppColors.border,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 12.5,
                  color: ok ? AppColors.ink : AppColors.muted,
                  fontWeight: ok ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
          ],
        ),
      );
}
