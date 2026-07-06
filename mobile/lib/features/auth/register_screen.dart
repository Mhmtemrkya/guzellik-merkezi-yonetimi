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
  DateTime? birthDate;
  int gender = 1; // 1 Kadın (varsayılan), 2 Erkek, 3 Diğer
  bool loading = false;
  String? error;

  @override
  void dispose() {
    nameController.dispose();
    phoneController.dispose();
    emailController.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (!formKey.currentState!.validate()) return;
    if (birthDate == null) {
      setState(() => error = 'Doğum tarihinizi seçin.');
      return;
    }
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final d = birthDate!;
      await widget.auth.customerRegister(
        fullName: nameController.text,
        phone: phoneController.text,
        birthDate:
            '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
        gender: gender,
        email: emailController.text,
      );
      // Başarılıysa AuthController durumu signedIn olur ve router otomatik yönlendirir.
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
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
                                decoration: const InputDecoration(
                                  labelText: 'Doğum Tarihi',
                                  prefixIcon: Icon(Icons.cake_outlined),
                                ),
                                child: Text(
                                  birthDate == null
                                      ? 'Seçilmedi'
                                      : '${birthDate!.day.toString().padLeft(2, '0')}.${birthDate!.month.toString().padLeft(2, '0')}.${birthDate!.year}',
                                  style: TextStyle(
                                    color: birthDate == null ? AppColors.muted : AppColors.ink,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            const Text('Cinsiyet',
                                style: TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.muted)),
                            const SizedBox(height: 6),
                            SegmentedButton<int>(
                              segments: const [
                                ButtonSegment(value: 1, label: Text('Kadın')),
                                ButtonSegment(value: 2, label: Text('Erkek')),
                                ButtonSegment(value: 3, label: Text('Diğer')),
                              ],
                              selected: {gender},
                              onSelectionChanged: (s) => setState(() => gender = s.first),
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: emailController,
                              keyboardType: TextInputType.emailAddress,
                              autocorrect: false,
                              validator: (v) {
                                final t = (v ?? '').trim();
                                if (t.isEmpty) return null; // opsiyonel
                                return t.contains('@') && t.contains('.')
                                    ? null
                                    : 'Geçerli bir e-posta girin.';
                              },
                              decoration: const InputDecoration(
                                labelText: 'E-posta (opsiyonel)',
                                prefixIcon: Icon(Icons.mail_outline_rounded),
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
                            const SizedBox(height: 20),
                            FilledButton.icon(
                              onPressed: loading ? null : submit,
                              icon: loading
                                  ? const SizedBox.square(
                                      dimension: 18,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2, color: Colors.white),
                                    )
                                  : const Icon(Icons.check_rounded),
                              label: const Text('Kayıt Ol ve Devam Et'),
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
