import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_config.dart';
import '../../core/theme/app_theme.dart';

/// Giriş modu: personel/yönetici (e-posta + şifre) veya müşteri (ad soyad + telefon + doğrulama kodu).
enum LoginMode { staff, customer }

class LoginScreen extends StatefulWidget {
  const LoginScreen({required this.auth, super.key});
  final AuthController auth;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final formKey = GlobalKey<FormState>();
  LoginMode mode = LoginMode.staff;

  // Personel/yönetici
  final emailController = TextEditingController();
  final passwordController = TextEditingController();
  // Müşteri — kimlik: ad soyad + telefon. DOĞUM TARİHİ SORULMAZ (App Store 5.1.1(v)):
  // randevu almak için gerekmediği hâlde zorunlu tutulduğu için uygulama reddedildi.
  final phoneController = TextEditingController();
  final nameController = TextEditingController();
  // Müşteri doğrulama kodu: kod istendi mi + kod alanı + bilgi + kanal.
  final otpCodeController = TextEditingController();
  bool otpStage = false;
  String? otpInfo;

  Timer? debounce;
  bool obscure = true;
  bool remember = true;
  bool loading = false;
  bool scopeLoading = false;
  String? error;
  String? role;
  List<Map<String, dynamic>> tenants = [];
  String? tenantId;
  String? branchId;

  @override
  void dispose() {
    debounce?.cancel();
    emailController.dispose();
    passwordController.dispose();
    phoneController.dispose();
    nameController.dispose();
    otpCodeController.dispose();
    super.dispose();
  }

  void _switchMode(LoginMode next) {
    if (next == mode) return;
    debounce?.cancel();
    setState(() {
      mode = next;
      error = null;
      role = null;
      tenants = [];
      tenantId = null;
      branchId = null;
      otpStage = false;
      otpInfo = null;
      otpCodeController.clear();
    });
  }

  // ----------------------- Personel/yönetici kapsam çözümü -----------------------

  void onEmailChanged(String value) {
    debounce?.cancel();
    final email = value.trim();
    setState(() {
      role = null;
      tenants = [];
      tenantId = null;
      branchId = null;
      error = null;
    });
    if (!email.contains('@') || !email.contains('.')) {
      return;
    }
    debounce = Timer(const Duration(milliseconds: 450), () => loadScope(email));
  }

  Future<bool> loadScope(String email) async {
    final normalizedEmail = email.trim().toLowerCase();
    setState(() {
      scopeLoading = true;
      error = null;
    });
    try {
      // Parola ile birlikte istenir: kapsam ucu artık parola doğrulanmadan bilgi vermez.
      final scope = (await widget.auth.loginScope(normalizedEmail, password: passwordController.text)).first;
      if (!mounted ||
          emailController.text.trim().toLowerCase() != normalizedEmail) {
        return false;
      }
      final rawTenants = (scope['tenants'] as List?) ?? const [];
      final resolvedTenants = rawTenants
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList();
      final resolvedRole = scope['role']?.toString();
      setState(() {
        tenants = resolvedTenants;
        role = resolvedRole;
        if (resolvedTenants.isNotEmpty) {
          tenantId = '${resolvedTenants.first['tenantId'] ?? ''}';
          final branches = _branchesOf(resolvedTenants.first);
          branchId = branches.isEmpty
              ? null
              : '${branches.firstWhere((e) => e['isDefault'] == true, orElse: () => branches.first)['branchId']}';
        }
      });
      return resolvedRole != null;
    } catch (e) {
      if (mounted &&
          emailController.text.trim().toLowerCase() == normalizedEmail) {
        setState(() => error = '$e');
      }
      return false;
    } finally {
      if (mounted) setState(() => scopeLoading = false);
    }
  }

  List<Map<String, dynamic>> _branchesOf(Map<String, dynamic>? tenant) =>
      ((tenant?['branches'] as List?) ?? const [])
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList();

  String? _tenantIdOf(Map<String, dynamic>? tenant) {
    final raw = '${tenant?['tenantId'] ?? tenant?['id'] ?? ''}';
    return raw.isEmpty ? null : raw;
  }

  String? _branchIdOf(Map<String, dynamic>? branch) {
    final raw = '${branch?['branchId'] ?? branch?['id'] ?? ''}';
    return raw.isEmpty ? null : raw;
  }

  /// Varsayılan (merkez) şube, yoksa ilk şube.
  Map<String, dynamic>? _defaultBranchOf(List<Map<String, dynamic>> branches) => branches.isEmpty
      ? null
      : branches.firstWhere((e) => e['isDefault'] == true, orElse: () => branches.first);

  // ----------------------------------- Gönder -----------------------------------

  Future<void> submit() async {
    if (!formKey.currentState!.validate()) return;
    debounce?.cancel();

    if (mode == LoginMode.customer) {
      setState(() {
        loading = true;
        error = null;
      });
      try {
        if (!otpStage) {
          // KOD ZORUNLU: token yalnız kanal sahipliği doğrulandıktan sonra üretilir.
          await _requestOtp();
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
        );
      } catch (e) {
        if (mounted) setState(() => error = '$e');
      } finally {
        if (mounted) setState(() => loading = false);
      }
      return;
    }

    // Personel/yönetici: e-posta + şifre.
    if (role == null) {
      final roleFound = await loadScope(emailController.text);
      if (!mounted) return;
      if (!roleFound || role == null) {
        if (error == null) {
          setState(() => error = 'Bu e-posta için tanımlı rol bulunamadı.');
        }
        return;
      }
    }

    // PlatformAdmin kuruma bağlı değildir → seçim sorulmaz.
    if (role == 'PlatformAdmin') {
      await _doLogin(null, null);
      return;
    }

    // KAPSAM SEÇİMİ: önce kurum (çok kurumluysa), sonra şube (çok şubeliyse).
    //
    // Kurum seçimi eskiden HİÇ sorulmuyordu: `tenants.first` alınıyordu ve iki kuruma bağlı bir
    // yönetici mobilden hep aynı kuruma düşüyor, diğerine hiç giremiyordu. (Web'de kapsam modalı
    // ikisini de soruyor.)
    //
    // Seçimler YEREL değişkende taşınır; setState aynı çağrıda okunamayacağı için tenantId/branchId
    // state'lerine güvenilmez — web'deki giriş hatasının kök nedeni tam olarak buydu.
    var chosenTenant = tenants.isEmpty ? null : tenants.first;
    if (tenants.length > 1) {
      chosenTenant = await _pickTenant(tenants);
      if (!mounted || chosenTenant == null) return; // iptal
    }

    final branches = _branchesOf(chosenTenant);
    var chosenBranchId = _branchIdOf(_defaultBranchOf(branches));
    if (branches.length > 1) {
      final picked = await _pickBranch(branches);
      if (!mounted || picked == null) return; // iptal
      chosenBranchId = picked;
    }

    // Satır içi özet de seçimi yansıtsın.
    setState(() {
      tenantId = _tenantIdOf(chosenTenant);
      branchId = chosenBranchId;
    });

    await _doLogin(_tenantIdOf(chosenTenant), chosenBranchId);
  }

  /// KURUMSAL KAYIT — tarayıcıda web sitesindeki kayıt sayfasını açar.
  ///
  /// Akış bilerek uygulamaya taşınmadı: kurum kaydı iki faktörlü doğrulama (e-posta + telefon),
  /// giriş bilgileri PDF'i ve abonelik/ödeme adımlarını içeriyor. Bunları mobilde ikinci kez
  /// kurmak, iki yerde ayrışan ve biri her zaman geride kalan bir akış üretirdi. Uygulama
  /// kullanıcıyı tek doğru yere gönderir.
  Future<void> _openTenantSignup() async {
    final uri = Uri.parse('${ApiConfig.publicWebBaseUrl}/kayit');
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      // Tarayıcı açılamadıysa adresi göster; kullanıcı elle yazabilsin.
      setState(() => error = 'Tarayıcı açılamadı. Kayıt için: ${uri.toString()}');
    }
  }

  /// OTP adım 1: kimlik geçerliyse seçilen kanaldan kodu iste, kod adımına geç.
  Future<void> _requestOtp() async {
    if (!formKey.currentState!.validate()) return;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final res = await widget.auth.customerOtpRequest(
        fullName: nameController.text,
        phone: phoneController.text,
        channel: CustomerOtpChannel.email.code, // giriş = e-posta (sunucu da ezer)
      );
      if (!mounted) return;
      final devCode = res['devCode']?.toString();
      // `hint` sunucudan gelir: kod gelmediğinde ne yapılacağını söyler. Yalnız e-posta kanalının
      // kurulu olduğu bir platformda, kayıtlarda adresi olmayan kullanıcı için tek çıkış yolu bu.
      final hint = res['hint']?.toString();
      setState(() {
        otpStage = true;
        otpCodeController.clear();
        final base = (devCode != null && devCode.isNotEmpty)
            ? 'Doğrulama kodu gönderildi. (Test kodu: $devCode)'
            : 'Bilgileriniz kayıtlarımızla eşleşiyorsa 6 haneli doğrulama kodunuz gönderildi. Kod 5 dakika geçerlidir.';
        otpInfo = (hint == null || hint.isEmpty) ? base : '$base $hint';
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  /// Seçilen kapsamla giriş yapar. Kurum ve şube PARAMETRE olarak gelir: state'e bakmak,
  /// seçim aynı çağrıda yapıldığında bayat değer okumak demektir.
  Future<void> _doLogin(String? chosenTenantId, String? chosenBranchId) async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      await widget.auth.login(
        email: emailController.text,
        password: passwordController.text,
        role: role!,
        tenantId: role == 'PlatformAdmin' ? null : chosenTenantId,
        branchId: role == 'PlatformAdmin' ? null : chosenBranchId,
        remember: remember,
      );
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  /// Çok kurumlu hesapta giriş yapılacak kurumu seçtiren alt sayfa. İptal edilirse null döner.
  Future<Map<String, dynamic>?> _pickTenant(List<Map<String, dynamic>> options) {
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.border,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Text('Kurum seçin',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.ink)),
                const SizedBox(height: 4),
                const Text('Hesabınız birden fazla kuruma bağlı. Devam etmek istediğiniz kurumu seçin.',
                    style: TextStyle(color: AppColors.muted, fontSize: 13)),
                const SizedBox(height: 14),
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: options.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final t = options[i];
                      final branchCount = _branchesOf(t).length;
                      return Card(
                        margin: EdgeInsets.zero,
                        child: ListTile(
                          leading: const CircleAvatar(
                            backgroundColor: AppColors.rose,
                            child: Icon(Icons.apartment_rounded, color: AppColors.primaryDark),
                          ),
                          title: Text(t['tenantName']?.toString() ?? t['name']?.toString() ?? 'Kurum',
                              style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text('$branchCount şube'),
                          trailing: const Icon(Icons.arrow_forward_ios_rounded,
                              size: 15, color: AppColors.primary),
                          onTap: () => Navigator.of(sheetContext).pop(t),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  /// Çok şubeli kurumda giriş yapılacak şubeyi seçtiren alt sayfa. İptal edilirse null döner.
  Future<String?> _pickBranch(List<Map<String, dynamic>> branches) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.border,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Text('Şube seçin',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.ink)),
                const SizedBox(height: 4),
                const Text('Bu kurumda birden fazla şube var. Devam etmek istediğiniz şubeyi seçin.',
                    style: TextStyle(color: AppColors.muted, fontSize: 13)),
                const SizedBox(height: 14),
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: branches.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final b = branches[i];
                      final isDefault = b['isDefault'] == true;
                      return Card(
                        margin: EdgeInsets.zero,
                        child: ListTile(
                          leading: const CircleAvatar(
                            backgroundColor: AppColors.rose,
                            child: Icon(Icons.storefront_rounded, color: AppColors.primaryDark),
                          ),
                          title: Text(b['branchName']?.toString() ?? b['name']?.toString() ?? 'Şube',
                              style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text(b['city']?.toString() ?? ''),
                          trailing: isDefault
                              ? Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppColors.rose,
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                  child: const Text('Merkez',
                                      style: TextStyle(
                                          fontSize: 10,
                                          color: AppColors.primaryDark,
                                          fontWeight: FontWeight.w700)),
                                )
                              : const Icon(Icons.arrow_forward_ios_rounded,
                                  size: 15, color: AppColors.primary),
                          onTap: () =>
                              Navigator.of(sheetContext).pop('${b['branchId'] ?? b['id'] ?? ''}'),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isCustomer = mode == LoginMode.customer;
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
                      padding: const EdgeInsets.fromLTRB(22, 26, 22, 24),
                      child: Form(
                        key: formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Center(
                              child: Image.asset(
                                'assets/images/logo.png',
                                height: 58,
                                errorBuilder: (_, _, _) => const Icon(
                                  Icons.auto_awesome,
                                  size: 42,
                                  color: AppColors.primary,
                                ),
                              ),
                            ),
                            const SizedBox(height: 22),
                            const Text(
                              'HOŞ GELDİN',
                              style: TextStyle(
                                color: AppColors.primaryDark,
                                fontWeight: FontWeight.w800,
                                fontSize: 10,
                                letterSpacing: 2.4,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Hesabına giriş yap',
                              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: -.7,
                                  ),
                            ),
                            const SizedBox(height: 16),
                            // ---- Mod seçici: Personel/Yönetici | Müşteri ----
                            SizedBox(
                              width: double.infinity,
                              child: SegmentedButton<LoginMode>(
                                segments: const [
                                  ButtonSegment(
                                    value: LoginMode.staff,
                                    icon: Icon(Icons.badge_outlined, size: 18),
                                    label: Text('Personel / Yönetici'),
                                  ),
                                  ButtonSegment(
                                    value: LoginMode.customer,
                                    icon: Icon(Icons.person_outline_rounded, size: 18),
                                    label: Text('Müşteri'),
                                  ),
                                ],
                                selected: {mode},
                                onSelectionChanged: (s) => _switchMode(s.first),
                              ),
                            ),
                            const SizedBox(height: 18),
                            if (isCustomer) ..._customerFields() else ..._staffFields(),
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
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Icon(Icons.arrow_forward_rounded),
                              label: Text(isCustomer
                                  ? (otpStage ? 'Kodu Doğrula ve Giriş Yap' : 'Giriş Yap')
                                  : 'Giriş Yap ve Devam Et'),
                            ),
                            // Ayrı "WhatsApp kodu ile giriş" butonu kaldırıldı: kod artık ALTERNATİF
                            // değil, tek yol; kanalı yukarıdaki seçici belirler.
                            if (isCustomer) ...[
                              const SizedBox(height: 6),
                              Center(
                                child: TextButton.icon(
                                  onPressed: loading ? null : () => context.push('/register'),
                                  icon: const Icon(Icons.person_add_alt_1_rounded, size: 18),
                                  label: const Text('Hesabın yok mu? Kayıt ol'),
                                ),
                              ),
                            ] else ...[
                              // KURUMSAL KAYIT WEB'DE YAPILIR (bkz. _openTenantSignup).
                              const SizedBox(height: 6),
                              Center(
                                child: TextButton.icon(
                                  onPressed: loading ? null : _openTenantSignup,
                                  icon: const Icon(Icons.storefront_rounded, size: 18),
                                  label: const Text('İşletmenizi kaydedin — 14 gün ücretsiz'),
                                ),
                              ),
                            ],
                            const SizedBox(height: 12),
                            _infoBox(isCustomer),
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

  // --------------------------------- Alan grupları ---------------------------------

  List<Widget> _staffFields() => [
        TextFormField(
          controller: emailController,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          onChanged: onEmailChanged,
          validator: (value) {
            final v = (value ?? '').trim();
            return (v.contains('@') && v.contains('.')) ? null : 'Geçerli bir e-posta girin.';
          },
          decoration: InputDecoration(
            labelText: 'E-posta',
            hintText: 'ornek@beautyasist.com',
            prefixIcon: const Icon(Icons.mail_outline_rounded),
            suffixIcon: scopeLoading
                ? const Padding(
                    padding: EdgeInsets.all(14),
                    child: SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : null,
          ),
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: passwordController,
          obscureText: obscure,
          validator: (value) => (value ?? '').isEmpty ? 'Parola zorunlu.' : null,
          onFieldSubmitted: (_) => submit(),
          decoration: InputDecoration(
            labelText: 'Şifre',
            prefixIcon: const Icon(Icons.lock_outline_rounded),
            suffixIcon: IconButton(
              onPressed: () => setState(() => obscure = !obscure),
              icon: Icon(obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
            ),
          ),
        ),
        const SizedBox(height: 6),
        // "Beni hatırla" — web ile aynı: açıksa oturum kalıcı saklanır,
        // kapalıysa uygulama tamamen kapanınca tekrar giriş gerekir.
        InkWell(
          onTap: () => setState(() => remember = !remember),
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(
              children: [
                SizedBox(
                  width: 22,
                  height: 22,
                  child: Checkbox(
                    value: remember,
                    onChanged: (v) => setState(() => remember = v ?? true),
                    activeColor: AppColors.primary,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    visualDensity: VisualDensity.compact,
                  ),
                ),
                const SizedBox(width: 10),
                const Text(
                  'Beni hatırla',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                    fontSize: 13,
                  ),
                ),
                const Spacer(),
                Text(
                  remember ? 'Oturum açık kalır' : 'Çıkışta sona erer',
                  style: const TextStyle(color: AppColors.muted, fontSize: 11),
                ),
              ],
            ),
          ),
        ),
      ];

  List<Widget> _customerFields() => [
        TextFormField(
          controller: nameController,
          textCapitalization: TextCapitalization.words,
          validator: (value) => (value ?? '').trim().isEmpty ? 'Ad soyad zorunlu.' : null,
          decoration: const InputDecoration(
            labelText: 'Ad Soyad',
            prefixIcon: Icon(Icons.badge_outlined),
          ),
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: phoneController,
          keyboardType: TextInputType.phone,
          autocorrect: false,
          validator: (value) {
            final digits = (value ?? '').replaceAll(RegExp(r'\D'), '');
            return digits.length >= 10 ? null : 'Geçerli bir telefon girin.';
          },
          decoration: const InputDecoration(
            labelText: 'Telefon',
            hintText: '0555 123 45 67',
            prefixIcon: Icon(Icons.phone_outlined),
          ),
        ),
        // KANAL SEÇİMİ: kod tek bir uygulamaya mahkûm değildir. WhatsApp'ı olmayan kullanıcı
        // SMS ya da e-posta ile giriş yapar (App Store 3.2.2(v)).
        if (!otpStage) ..._channelNotice(),
        // Kod adımı — kod istendiyse 6 haneli kodu gir.
        if (otpStage) ...[
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (otpInfo != null)
                  Text(
                    otpInfo!,
                    style: const TextStyle(color: AppColors.muted, fontSize: 12.5, height: 1.35),
                  ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: otpCodeController,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  autofocus: true,
                  onFieldSubmitted: (_) => submit(),
                  decoration: const InputDecoration(
                    labelText: 'Doğrulama Kodu',
                    hintText: '6 haneli kod',
                    prefixIcon: Icon(Icons.verified_outlined),
                    counterText: '',
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    TextButton(
                      onPressed: loading
                          ? null
                          : () => setState(() {
                              otpStage = false;
                              error = null;
                            }),
                      child: const Text('← Bilgilerle giriş'),
                    ),
                    TextButton(
                      onPressed: loading ? null : _requestOtp,
                      child: const Text('Kodu tekrar gönder'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ];

  /// GİRİŞTE KANAL SABİT: kod kayıtlı e-posta adresine gider.
  ///
  /// Seçim sunulmuyor çünkü kural akışa gömülü (sunucu da böyle zorluyor): kayıt telefonu
  /// SMS ile doğrular, giriş e-posta ile. Kayıtlı kullanıcı her girişte SMS harcamaz.
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
              Icon(Icons.mail_outline_rounded, size: 18, color: AppColors.primaryDark),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Doğrulama kodu kayıtlı e-posta adresinize gönderilecek.',
                  style: TextStyle(color: AppColors.muted, fontSize: 12, height: 1.35),
                ),
              ),
            ],
          ),
        ),
      ];

  Widget _infoBox(bool isCustomer) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.info_outline_rounded, size: 18, color: AppColors.primaryDark),
            const SizedBox(width: 10),
            Expanded(
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: isCustomer ? 'Müşteri girişi: ' : 'Personel / yönetici girişi: ',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        color: AppColors.primaryDark,
                        fontSize: 12.5,
                      ),
                    ),
                    TextSpan(
                      text: isCustomer
                          ? 'Ad soyadınızı ve telefonunuzu (başında 0 ile) girin; size gönderilen 6 haneli kodla giriş yaparsınız. Şifre gerekmez. Hesabınız yoksa “Kayıt ol” ile oluşturabilirsiniz.'
                          : 'Kurumsal e-posta ve şifrenizle giriş yapın.',
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12.5,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
}
