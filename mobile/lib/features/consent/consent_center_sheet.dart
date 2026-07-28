import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/consent/consent_pdf.dart';
import '../../shared/json_helpers.dart';
import 'consent_models.dart';

/// Bekleyen imzayı yakalamak için yoklama sıklığı.
const _pollInterval = Duration(seconds: 3);
const _stationHint = 'Kabin 1';

/// ONAM FORMU MERKEZİ (mobil) — web `ConsentCenterModal` paritesi.
///
/// Personel formu açar, uygulama notunu yazar, "Tablete Aktar" ile imza oturumu başlatır.
/// Müşteri tablette imzalayınca bu sayfa yoklama ile yakalar ve "Form imzalandı" der.
/// İmzalı belge logolu PDF olarak paylaşılabilir.
class ConsentCenterSheet extends StatefulWidget {
  const ConsentCenterSheet({
    required this.api,
    required this.customerId,
    this.customerName,
    this.appointmentId,
    super.key,
  });

  final ApiClient api;
  final String customerId;
  final String? customerName;
  final String? appointmentId;

  /// Tam ekran sayfa olarak açar; kapanışta değişiklik olduysa true döner.
  static Future<bool?> open(
    BuildContext context, {
    required ApiClient api,
    required String customerId,
    String? customerName,
    String? appointmentId,
  }) {
    return Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => ConsentCenterSheet(
          api: api,
          customerId: customerId,
          customerName: customerName,
          appointmentId: appointmentId,
        ),
      ),
    );
  }

  @override
  State<ConsentCenterSheet> createState() => _ConsentCenterSheetState();
}

class _ConsentCenterSheetState extends State<ConsentCenterSheet> {
  ConsentStatus? _status;
  List<ConsentForm> _forms = const [];
  String? _logo;
  String _institution = 'Kurum';
  bool _loading = true;
  bool _changed = false;
  String? _busyId;
  String? _error;
  String? _signedToast;
  Timer? _poll;

  ConsentForm? _openForm;
  final _notes = TextEditingController();
  final _station = TextEditingController(text: _stationHint);

  @override
  void initState() {
    super.initState();
    _load();
    _loadBrand();
    _poll = Timer.periodic(_pollInterval, (_) => _checkSignatures());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _notes.dispose();
    _station.dispose();
    super.dispose();
  }

  /// Kurum adı + logo — PDF başlığı için (KVKK sheet'iyle aynı kaynak).
  Future<void> _loadBrand() async {
    Future<Map<String, dynamic>> g(String path) async {
      try {
        final r = await widget.api.get(path);
        return r is Map ? r.cast<String, dynamic>() : <String, dynamic>{};
      } catch (_) {
        return <String, dynamic>{};
      }
    }

    final results = await Future.wait([g('/api/admin/tenant/'), g('/api/admin/tenant/public-profile')]);
    if (!mounted) return;
    final name = '${results[0]['name'] ?? results[0]['tenantName'] ?? ''}'.trim();
    final logo = '${results[1]['logoData'] ?? ''}'.trim();
    setState(() {
      if (name.isNotEmpty) _institution = name;
      _logo = logo.isEmpty ? null : logo;
    });
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final statusPath = widget.appointmentId != null
          ? '/api/consent/appointments/${widget.appointmentId}/status'
          : '/api/consent/customers/${widget.customerId}/status';
      final results = await Future.wait<dynamic>([
        widget.api.get(statusPath),
        widget.api.get('/api/consent/customers/${widget.customerId}'),
      ]);
      if (!mounted) return;
      setState(() {
        _status = results[0] is Map ? ConsentStatus((results[0] as Map).cast<String, dynamic>()) : null;
        _forms = apiItems(results[1]).map(ConsentForm.new).toList();
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// İmza bekleyen form imzalandıysa bildirim göster + listeyi tazele.
  Future<void> _checkSignatures() async {
    final awaiting = _forms.where((f) => f.isAwaiting).map((f) => f.id).toSet();
    if (awaiting.isEmpty || !mounted) return;
    try {
      final fresh = apiItems(await widget.api.get('/api/consent/customers/${widget.customerId}'))
          .map(ConsentForm.new)
          .toList();
      final justSigned = fresh.where((f) => awaiting.contains(f.id) && f.isSigned).toList();
      if (!mounted) return;
      setState(() => _forms = fresh);
      if (justSigned.isNotEmpty) {
        setState(() {
          _signedToast = justSigned.first.title;
          _changed = true;
        });
        await _load();
        if (mounted) {
          Timer(const Duration(seconds: 6), () {
            if (mounted) setState(() => _signedToast = null);
          });
        }
      }
    } catch (_) {
      // ağ hatası — bir sonraki turda yeniden dener
    }
  }

  ConsentForm? _latestFor(String? templateId) {
    if (templateId == null || templateId.isEmpty) return null;
    final mine = _forms.where((f) => f.templateId == templateId).toList();
    if (mine.isEmpty) return null;
    final signed = mine.where((f) => f.isSigned).toList();
    final pool = signed.isNotEmpty ? signed : mine;
    pool.sort((a, b) => '${b.raw['signedAtUtc'] ?? b.raw['createdAtUtc'] ?? ''}'
        .compareTo('${a.raw['signedAtUtc'] ?? a.raw['createdAtUtc'] ?? ''}'));
    return pool.first;
  }

  Future<void> _run(String id, Future<void> Function() task) async {
    setState(() {
      _busyId = id;
      _error = null;
    });
    try {
      await task();
      _changed = true;
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _openTemplate(ConsentRequirement req) async {
    setState(() {
      _busyId = req.templateId;
      _error = null;
    });
    try {
      final existing = _latestFor(req.templateId);
      Map<String, dynamic>? data;
      if (existing != null && !existing.isSigned) {
        data = existing.raw;
      } else {
        final created = await widget.api.post('/api/consent/forms', {
          'customerId': widget.customerId,
          'templateId': req.templateId,
          'appointmentId': widget.appointmentId,
          'serviceDefinitionId': req.serviceDefinitionId,
          'staffNotes': null,
        });
        data = created is Map ? created.cast<String, dynamic>() : null;
      }
      if (data == null) throw 'Form açılamadı';
      final form = ConsentForm(data);
      setState(() {
        _openForm = form;
        _notes.text = form.staffNotes ?? '';
      });
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _sendToTablet(ConsentForm form) async {
    final station = _station.text.trim();
    if (station.isEmpty) {
      setState(() => _error = 'Önce tablet adı girin (ör. Kabin 1).');
      return;
    }
    await _run(form.id, () async {
      if (_notes.text.trim() != (form.staffNotes ?? '')) {
        await widget.api.put('/api/consent/forms/${form.id}', {
          'staffNotes': _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        });
      }
      await widget.api.post('/api/consent/forms/${form.id}/session', {
        'stationName': station,
        'lifetimeMinutes': null,
      });
      if (mounted) setState(() => _openForm = null);
    });
  }

  Future<void> _sharePdf(ConsentForm form) async {
    try {
      await ConsentPdf.share(
        institutionName: _institution,
        title: form.title,
        body: ConsentPdf.fillPlaceholders(
          form.body,
          customerName: form.customerName ?? widget.customerName,
          serviceName: form.serviceName,
          institutionName: _institution,
          staffName: form.staffName,
          date: form.signedAt,
        ),
        logoBase64: _logo,
        checkItems: form.checkItems,
        checkedItems: form.checkedItems,
        customerName: form.customerName ?? widget.customerName,
        serviceName: form.serviceName,
        staffName: form.staffName,
        staffNotes: form.staffNotes,
        signatureBase64: form.signatureImage,
        signedAt: form.signedAt,
        signerName: form.signerName,
      );
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    final requirements = status?.requirements ?? const <ConsentRequirement>[];
    final missing = status?.missing ?? const <ConsentRequirement>[];

    return PopScope(
      canPop: true,
      onPopInvokedWithResult: (didPop, _) {},
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          title: const Text('Onam Formları'),
          leading: IconButton(
            icon: const Icon(Icons.close_rounded),
            onPressed: () => Navigator.of(context).pop(_changed),
          ),
        ),
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
              children: [
                Text(
                  widget.customerName ?? 'Müşteri',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
                if (status != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      '${status.signedCount}/${status.requiredCount} form imzalı',
                      style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
                    ),
                  ),
                const SizedBox(height: 14),

                if (_signedToast != null) ...[
                  _banner(
                    icon: Icons.check_circle_rounded,
                    color: AppColors.success,
                    title: 'Form imzalandı — $_signedToast',
                  ),
                  const SizedBox(height: 10),
                ],
                if (_error != null) ...[
                  _banner(icon: Icons.error_outline_rounded, color: AppColors.danger, title: _error!),
                  const SizedBox(height: 10),
                ],

                if (!_loading && requirements.isNotEmpty) ...[
                  _banner(
                    icon: missing.isEmpty ? Icons.verified_rounded : Icons.shield_outlined,
                    color: missing.isEmpty ? AppColors.success : AppColors.warning,
                    title: missing.isEmpty
                        ? 'Bu işlem için gereken onam formlarının tamamı imzalı.'
                        : '${missing.length} onam formu eksik — işlem öncesi imzalanmalı.',
                    subtitle: missing.isEmpty ? null : missing.map((m) => m.title).join(' · '),
                  ),
                  const SizedBox(height: 12),
                ],

                if (_loading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 60),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (requirements.isEmpty)
                  _emptyState()
                else
                  for (final req in requirements) ...[
                    _requirementCard(req),
                    const SizedBox(height: 10),
                  ],

                // Bu işlem dışındaki imzalı formlar
                if (_forms.any((f) => f.isSigned && !requirements.any((r) => r.templateId == f.templateId))) ...[
                  const SizedBox(height: 8),
                  const Text('Diğer imzalı formlar',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.muted)),
                  const SizedBox(height: 8),
                  for (final f in _forms.where((f) => f.isSigned && !requirements.any((r) => r.templateId == f.templateId)))
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text(f.title, style: const TextStyle(fontSize: 13)),
                      subtitle: f.signedAt == null
                          ? null
                          : Text(
                              '${f.signedAt!.day.toString().padLeft(2, '0')}.${f.signedAt!.month.toString().padLeft(2, '0')}.${f.signedAt!.year}',
                              style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                            ),
                      trailing: TextButton.icon(
                        onPressed: () => _sharePdf(f),
                        icon: const Icon(Icons.download_rounded, size: 16),
                        label: const Text('PDF'),
                      ),
                    ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _banner({required IconData icon, required Color color, required String title, String? subtitle}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: .35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                if (subtitle != null) ...[
                  const SizedBox(height: 3),
                  Text(subtitle, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _emptyState() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 44, horizontal: 20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          const Icon(Icons.assignment_outlined, size: 40, color: AppColors.primary),
          const SizedBox(height: 12),
          const Text('Bu işlem için tanımlı onam formu yok',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 6),
          const Text(
            'Hizmet formundan “Onam formları” bölümüne form bağlarsanız burada listelenir ve '
            'randevu tamamlanmadan önce imza istenir.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.muted, fontSize: 12.5, height: 1.4),
          ),
        ],
      ),
    );
  }

  Widget _requirementCard(ConsentRequirement req) {
    final form = _latestFor(req.templateId);
    final key = form?.status;
    final busy = _busyId == req.templateId || (form != null && _busyId == form.id);
    final editing = _openForm != null && _openForm!.templateId == req.templateId && !_openForm!.isSigned;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(req.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 3),
                    Text(
                      [
                        if (req.serviceName != null) req.serviceName!,
                        if (form?.signedAt != null)
                          'İmza: ${form!.signedAt!.day.toString().padLeft(2, '0')}.${form.signedAt!.month.toString().padLeft(2, '0')}.${form.signedAt!.year}'
                        else if (key == 'AwaitingSignature')
                          '${form?.stationName ?? 'Tablet'} üzerinde imza bekleniyor…'
                        else
                          'Henüz imzalanmadı',
                      ].join(' · '),
                      style: const TextStyle(fontSize: 12, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: _statusColor(key).withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  key == null ? 'Alınmadı' : (kConsentStatusLabel[key] ?? key),
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: _statusColor(key)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (form != null && form.isSigned) ...[
                OutlinedButton.icon(
                  onPressed: () => _sharePdf(form),
                  icon: const Icon(Icons.download_rounded, size: 16),
                  label: const Text('PDF indir'),
                ),
                TextButton(
                  onPressed: busy ? null : () => _openTemplate(req),
                  child: const Text('Yeniden al'),
                ),
              ] else if (key == 'AwaitingSignature' && form != null) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                  decoration: BoxDecoration(
                    color: AppColors.warning.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.tablet_mac_rounded, size: 15, color: AppColors.warning),
                      const SizedBox(width: 6),
                      Text(form.stationName ?? 'Tablet',
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.warning)),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: busy ? null : () => _run(form.id, () => widget.api.delete('/api/consent/forms/${form.id}/session')),
                  child: const Text('Geri al'),
                ),
              ] else
                FilledButton.icon(
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 42)),
                  onPressed: busy ? null : () => _openTemplate(req),
                  icon: const Icon(Icons.edit_document, size: 16),
                  label: const Text('Formu doldur'),
                ),
            ],
          ),
          if (editing) ...[
            const Divider(height: 24),
            _editor(_openForm!),
          ],
        ],
      ),
    );
  }

  Widget _editor(ConsentForm form) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          constraints: const BoxConstraints(maxHeight: 170),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.background.withValues(alpha: .6),
            borderRadius: BorderRadius.circular(12),
          ),
          child: SingleChildScrollView(
            child: Text(
              ConsentPdf.fillPlaceholders(
                form.body,
                customerName: form.customerName ?? widget.customerName,
                serviceName: form.serviceName,
                institutionName: _institution,
                staffName: form.staffName,
              ),
              style: const TextStyle(fontSize: 12.5, height: 1.45),
            ),
          ),
        ),
        if (form.checkItems.isNotEmpty) ...[
          const SizedBox(height: 10),
          const Text('Müşteri onaylayacak',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
          const SizedBox(height: 6),
          for (final item in form.checkItems)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.check_box_outline_blank_rounded, size: 15, color: AppColors.muted),
                  const SizedBox(width: 6),
                  Expanded(child: Text(item, style: const TextStyle(fontSize: 12.5))),
                ],
              ),
            ),
        ],
        const SizedBox(height: 12),
        TextField(
          controller: _notes,
          maxLines: 2,
          decoration: const InputDecoration(
            labelText: 'Uygulama notu (doz, bölge, uyarı…)',
            hintText: 'Örn. 3. seans, sol bacak, 18 J/cm²',
          ),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _station,
          decoration: const InputDecoration(
            labelText: 'Tablet adı',
            hintText: _stationHint,
            prefixIcon: Icon(Icons.tablet_mac_rounded),
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: _busyId == form.id ? null : () => _sendToTablet(form),
                icon: const Icon(Icons.send_rounded, size: 17),
                label: Text(_busyId == form.id ? 'Gönderiliyor...' : 'Tablete Aktar'),
              ),
            ),
            const SizedBox(width: 8),
            TextButton(
              onPressed: () => setState(() => _openForm = null),
              child: const Text('Kapat'),
            ),
          ],
        ),
        const SizedBox(height: 4),
        const Text(
          'Form tablette açılır; müşteri onay kutularını işaretleyip imzalayınca buraya bildirim düşer.',
          style: TextStyle(fontSize: 11.5, color: AppColors.muted),
        ),
      ],
    );
  }

  static Color _statusColor(String? key) {
    switch (key) {
      case 'Signed':
        return AppColors.success;
      case 'AwaitingSignature':
        return AppColors.warning;
      case 'Cancelled':
        return AppColors.danger;
      default:
        return AppColors.muted;
    }
  }
}
