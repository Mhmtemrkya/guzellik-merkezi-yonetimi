import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';

/// Cihaz Güvenliği yönetimi — web `StaffDeviceDialog` paritesi, tam sayfa.
/// İçerik: kurum geneli aç/kapat + personel başına cihaz limiti + tanımlı
/// cihaz listesi (yeniden adlandır / sil). Yalnızca kurum yöneticisi kullanır.
///
/// Not: personel detayı zaten bir modal sheet olduğundan bunun üstüne ikinci
/// bir bottom sheet açmak emülatörde render/dokunma sorunları yarattı; bu
/// yüzden normal sayfa (Navigator.push) olarak tasarlandı.
class StaffDevicesScreen extends StatefulWidget {
  const StaffDevicesScreen({
    required this.api,
    required this.tenantUserId,
    required this.staffName,
    super.key,
  });

  final ApiClient api;
  final String tenantUserId;
  final String staffName;

  @override
  State<StaffDevicesScreen> createState() => _StaffDevicesScreenState();
}

class _StaffDevicesScreenState extends State<StaffDevicesScreen> {
  bool _loading = true;
  bool _saving = false;
  String? _loadError;
  String? _actionError;
  Map<String, dynamic>? _settings;
  Map<String, dynamic>? _limit;
  List<Map<String, dynamic>> _devices = const [];
  final _limitCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _limitCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final results = await Future.wait([
        widget.api.get('/api/admin/devices/settings'),
        widget.api.get('/api/admin/devices/users/${widget.tenantUserId}'),
        widget.api.get('/api/admin/devices/users/${widget.tenantUserId}/limit'),
      ]);
      if (!mounted) return;
      final devicesRaw = results[1];
      setState(() {
        _settings = (results[0] as Map?)?.cast<String, dynamic>();
        _devices = devicesRaw is List
            ? devicesRaw
                .whereType<Map>()
                .map((d) => d.cast<String, dynamic>())
                .toList()
            : const [];
        _limit = (results[2] as Map?)?.cast<String, dynamic>();
        final max = _limit?['maxDeviceCount'];
        _limitCtrl.text = max == null ? '' : '$max';
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadError = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _saving = true;
      _actionError = null;
    });
    try {
      await action();
      await _load();
    } catch (e) {
      if (mounted) setState(() => _actionError = '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _toggleEnabled() => _run(() async {
        await widget.api.put('/api/admin/devices/settings', {
          'enabled': _settings?['enabled'] != true,
        });
      });

  Future<void> _saveLimit() => _run(() async {
        final text = _limitCtrl.text.trim();
        await widget.api.put(
          '/api/admin/devices/users/${widget.tenantUserId}/limit',
          {'maxDeviceCount': text.isEmpty ? null : int.tryParse(text)},
        );
        if (mounted) FocusScope.of(context).unfocus();
      });

  Future<void> _rename(Map<String, dynamic> device) async {
    final ctrl = TextEditingController(text: '${device['name'] ?? ''}');
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cihazı yeniden adlandır'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Cihaz adı'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Vazgeç')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
              child: const Text('Kaydet')),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    await _run(() async {
      await widget.api.put('/api/admin/devices/${device['id']}', {
        'name': name,
        'deviceType': device['deviceType'],
      });
    });
  }

  Future<void> _remove(Map<String, dynamic> device) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cihaz silinsin mi?'),
        content: Text(
            '"${device['name']}" tanımdan kaldırılır; personel bu cihazdan tekrar giriş yaptığında (limit dahilinde) yeniden tanımlanır.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() async {
      await widget.api.delete('/api/admin/devices/${device['id']}');
    });
  }

  @override
  Widget build(BuildContext context) {
    // logs_screen ile aynı iskelet: AppBackground > Scaffold(transparent) >
    // SafeArea > ListView. (Emülatörde başka iskeletler body'yi boyamıyordu.)
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 40),
            children: [
              PageHeader(
                eyebrow: 'Güvenlik',
                title: 'Cihaz Güvenliği',
                subtitle: '${widget.staffName} · tanımlı cihazlar ve giriş kısıtı.',
                action: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      onPressed: _loading ? null : _load,
                      icon: const Icon(Icons.refresh_rounded),
                      color: AppColors.primaryDark,
                      tooltip: 'Yenile',
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      icon: const Icon(Icons.close_rounded),
                      color: AppColors.primaryDark,
                      tooltip: 'Kapat',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              if (_loading)
                const Padding(
                  padding: EdgeInsets.all(40),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_loadError != null)
                _errorState()
              else ...[
                if (_actionError != null) ...[
                  _banner(_actionError!),
                  const SizedBox(height: 10),
                ],
                _settingsCard(),
                const SizedBox(height: 10),
                _limitCard(),
                const SizedBox(height: 18),
                const Text('TANIMLI CİHAZLAR',
                    style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.primaryDark,
                        letterSpacing: .8)),
                const SizedBox(height: 8),
                if (_devices.isEmpty) _emptyDevices(),
                for (final d in _devices) _deviceTile(d),
              ],
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- widgets

  Widget _banner(String message) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: AppColors.danger.withValues(alpha: .08),
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: AppColors.danger.withValues(alpha: .35)),
        ),
        child: Text(message,
            style: const TextStyle(color: AppColors.danger, fontSize: 12)),
      );

  Widget _errorState() => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_rounded,
                  size: 40, color: AppColors.primary),
              const SizedBox(height: 10),
              Text(_loadError ?? '', textAlign: TextAlign.center),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Tekrar dene'),
              ),
            ],
          ),
        ),
      );

  /// Kurum düzeyinde aç/kapat (web dialogdaki üst kart).
  Widget _settingsCard() {
    final enabled = _settings?['enabled'] == true;
    final featureAllowed = _settings?['featureAllowed'] != false;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(Icons.verified_user_rounded,
              size: 22,
              color: enabled ? AppColors.success : AppColors.muted),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Cihaz güvenliği (kurum geneli)',
                    style:
                        TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                const SizedBox(height: 2),
                Text(
                  featureAllowed
                      ? 'Açıkken personel yalnızca tanımlı cihazlarından giriş yapabilir; loglara cihaz + ağ bilgisi düşer.'
                      : 'Bu özellik paketinize dahil değil — paket yükseltmesi gerekir.',
                  style: const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Switch(
            value: enabled,
            onChanged:
                _saving || !featureAllowed ? null : (_) => _toggleEnabled(),
            activeThumbColor: Colors.white,
            activeTrackColor: AppColors.success,
          ),
        ],
      ),
    );
  }

  /// Personel başına cihaz limiti (web dialogdaki ikinci kart).
  Widget _limitCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Cihaz limiti',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
          const SizedBox(height: 2),
          Text(
            'Bu personelin tanımlayabileceği en fazla cihaz sayısı (boş = sınırsız). Şu an ${_limit?['deviceCount'] ?? 0} cihaz tanımlı.',
            style: const TextStyle(fontSize: 11, color: AppColors.muted),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _limitCtrl,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Cihaz sayısı (örn. 2) — boş = sınırsız',
              prefixIcon: const Icon(Icons.devices_rounded, size: 18),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AppColors.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AppColors.border),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: _saving ? null : _saveLimit,
                  icon: const Icon(Icons.save_rounded, size: 17),
                  label: const Text('Limiti Kaydet'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton(
                  onPressed: _saving
                      ? null
                      : () {
                          _limitCtrl.clear();
                          _saveLimit();
                        },
                  child: const Text('Sınırsız yap'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _emptyDevices() => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: const Column(
          children: [
            Icon(Icons.devices_other_rounded,
                size: 34, color: AppColors.muted),
            SizedBox(height: 8),
            Text(
              'Henüz tanımlı cihaz yok.\nPersonel bir sonraki girişinde cihazı otomatik tanımlanır (limit dahilinde).',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.muted, fontSize: 12.5),
            ),
          ],
        ),
      );

  Widget _deviceTile(Map<String, dynamic> d) {
    final isMobile = '${d['deviceType'] ?? ''}'.toLowerCase() == 'mobile';
    final deviceId = '${d['deviceId'] ?? ''}';
    final ip = '${d['lastIpAddress'] ?? ''}';
    final seen = DateTime.tryParse('${d['lastSeenUtc'] ?? ''}')?.toLocal();
    final meta = <String>[
      if (deviceId.isNotEmpty)
        deviceId.substring(0, deviceId.length < 12 ? deviceId.length : 12),
      if (ip.isNotEmpty) 'IP $ip',
      if (seen != null)
        'Son: ${seen.day}.${seen.month}.${seen.year} ${seen.hour.toString().padLeft(2, '0')}:${seen.minute.toString().padLeft(2, '0')}',
    ];
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(
                isMobile ? Icons.smartphone_rounded : Icons.computer_rounded,
                color: AppColors.primaryDark,
                size: 19),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${d['name'] ?? 'Cihaz'}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 13)),
                const SizedBox(height: 2),
                Text(meta.join(' · '),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style:
                        const TextStyle(fontSize: 10.5, color: AppColors.muted)),
              ],
            ),
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            onPressed: _saving ? null : () => _rename(d),
            icon: const Icon(Icons.edit_rounded, size: 18),
            color: AppColors.primaryDark,
            tooltip: 'Yeniden adlandır',
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            onPressed: _saving ? null : () => _remove(d),
            icon: const Icon(Icons.delete_outline_rounded, size: 18),
            color: AppColors.danger,
            tooltip: 'Cihazı sil',
          ),
        ],
      ),
    );
  }
}
