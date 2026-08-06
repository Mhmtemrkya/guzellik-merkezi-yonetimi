import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/customer_call.dart';
import '../accounting/adisyon_detail_sheet.dart';
import 'calendar_theme.dart';
import 'complete_appointment.dart';

/// Appointment detail bottom sheet with edit / cancel / customer profile.
class AppointmentDetailSheet extends StatefulWidget {
  const AppointmentDetailSheet({
    required this.api,
    required this.appointment,
    super.key,
  });
  final ApiClient api;
  final Map<String, dynamic> appointment;

  @override
  State<AppointmentDetailSheet> createState() => _AppointmentDetailSheetState();
}

class _AppointmentDetailSheetState extends State<AppointmentDetailSheet> {
  late Map<String, dynamic> appt = Map.of(widget.appointment);
  Map<String, dynamic>? customer;
  bool _busy = false;
  /// WhatsApp hatırlatması gönderilirken buton kilitlenir (çift gönderim olmasın).
  bool _reminderBusy = false;

  @override
  void initState() {
    super.initState();
    _loadCustomer();
  }

  Future<void> _loadCustomer() async {
    final id = appt['customerId'];
    if (id == null) return;
    try {
      final data = await widget.api.get('/api/admin/customers/$id');
      if (mounted && data is Map) {
        setState(() => customer = data.cast<String, dynamic>());
      }
    } catch (_) {}
  }

  DateTime? get _start => parseUtcToLocal(appt['startUtc']);
  DateTime? get _end => parseUtcToLocal(appt['endUtc']);

  String get _durationText {
    final s = _start, e = _end;
    if (s == null || e == null) return '';
    final mins = e.difference(s).inMinutes;
    final h = mins ~/ 60;
    final m = mins % 60;
    if (h > 0 && m > 0) return ' ($h sa $m dk)';
    if (h > 0) return ' (${h}s)';
    return ' ($m dk)';
  }

  Future<void> _cancel() async {
    final reason = await _askReason('Randevuyu iptal et', 'İptal sebebi');
    if (reason == null) return;
    await _run(() async {
      await widget.api.patch('/api/admin/appointments/${appt['id']}/status', {
        'status': 'Cancelled',
        'reason': reason.isEmpty ? null : reason,
      });
    }, 'Randevu iptal edildi.');
  }

  /// Müşterinin WhatsApp onay durumu — web'deki rozetin karşılığı.
  /// (etiket, renk) döner; None ise rozet gösterilmez.
  static (String, Color)? _confirmationMeta(String value) => switch (value) {
        'Pending' => ('Onay bekliyor', const Color(0xFFA3701F)),
        'Confirmed' => ('Onayladı', AppColors.success),
        'Declined' => ('İptal etti', AppColors.danger),
        'RescheduleRequested' => ('Erteleme istedi', Color(0xFF7C5CBF)),
        _ => null,
      };

  /// WhatsApp hatırlatması gönder. Sonuç (gönderildi / simülasyon / onaya düştü)
  /// kullanıcıya bildirilir; başarılıysa randevu tazelenir ki onay rozeti güncellensin.
  Future<void> _sendWhatsappReminder() async {
    setState(() => _reminderBusy = true);
    try {
      final res = await widget.api
          .post('/api/admin/whatsapp/reminder/${appt['id']}', const {});
      final map = res is Map ? res.cast<String, dynamic>() : const <String, dynamic>{};
      // Personel onay kapısı: istek taslağa düşmüş olabilir (id dönmez).
      final pending = map['pendingApproval'] == true || map.isEmpty;
      final simulated = map['simulated'] == true;
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(pending
            ? 'Hatırlatma onaya gönderildi.'
            : simulated
                ? 'Hatırlatma gönderildi (simülasyon).'
                : 'WhatsApp hatırlatması gönderildi.'),
      ));
      await _refreshAppointment();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Hatırlatma gönderilemedi: $e')));
      }
    } finally {
      if (mounted) setState(() => _reminderBusy = false);
    }
  }

  /// Randevuyu sunucudan tazeler (onay durumu rozeti için).
  Future<void> _refreshAppointment() async {
    try {
      final data = await widget.api.get('/api/admin/appointments/${appt['id']}');
      if (mounted && data is Map) {
        setState(() => appt = data.cast<String, dynamic>());
      }
    } catch (_) {
      /* tazeleme başarısız olsa da akış bozulmasın */
    }
  }

  /// Randevuyu KALICI sil. İptalden farklıdır: iptal kaydı durumuyla listede bırakır,
  /// silme kaydı tamamen kaldırır. Geri alınamaz olduğu için onay istenir.
  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Randevuyu sil'),
        content: Text(
          '${valueOf(appt, const ['customerName'], fallback: 'Müşteri')} randevusu '
          'kalıcı olarak silinsin mi? Bu işlem geri alınamaz.',
          style: const TextStyle(fontSize: 13),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Evet, sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() async {
      await widget.api.delete('/api/admin/appointments/${appt['id']}');
    }, 'Randevu silindi.');
  }

  /// YANLIŞ TAMAMLAMAYI GERİ AL (web paritesi).
  ///
  /// Tamamlanan randevu iptal/gelmedi yapılamaz — doğru: tamamlama seans/finans etkisi üretir.
  /// Yanlışlıkla tamamlanmış kayıt için tek düzeltme yolu budur: tüketilen paket seansı
  /// müşteriye iade edilir ve randevu "Onaylandı"ya döner. Tamamlama satışı cariye işlemişse
  /// backend reddeder; para hareketinin geri alma yolu satış iptalidir.
  Future<void> _voidCompletion() async {
    final reason = await _askReason(
      'Tamamlamayı geri al',
      'Geri alma gerekçesi (zorunlu)',
    );
    if (reason == null) return;
    if (reason.trim().length < 5) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Geri alma gerekçesini yazın (en az 5 karakter): bu düzeltme denetim kaydına işlenir.',
            ),
          ),
        );
      }
      return;
    }
    await _run(() async {
      await widget.api.post(
        '/api/admin/appointments/${appt['id']}/void-completion',
        {'reason': reason.trim()},
      );
    }, 'Randevunun tamamlanması geri alındı.');
  }

  /// Müşteri koltukta — randevuyu "İşlemde" yap (çizelgede mor kart).
  Future<void> _startService() async {
    await _run(() async {
      await widget.api.patch('/api/admin/appointments/${appt['id']}/status', {
        'status': 'InProgress',
        'reason': null,
      });
    }, 'Randevu işleme alındı.');
  }

  /// İşlem bitti → Tamamlandı. Ortak akış: "Ödeme alındı mı?" → tutar+yöntem → tahsilat.
  Future<void> _complete() async {
    final enriched = <String, dynamic>{
      ...appt,
      'customerName':
          '${appt['customerName'] ?? customer?['fullName'] ?? customer?['name'] ?? ''}',
    };
    final ok = await runCompleteAppointment(context, widget.api, enriched);
    if (ok && mounted) Navigator.pop(context, true);
  }

  Future<void> _edit() async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _EditSheet(api: widget.api, appointment: appt),
    );
    if (result == true && mounted) {
      // reload latest appointment record
      try {
        final data = await widget.api.get(
          '/api/admin/appointments/${appt['id']}',
        );
        if (mounted && data is Map) {
          setState(() => appt = data.cast<String, dynamic>());
        }
      } catch (_) {}
    }
  }

  Future<void> _run(Future<void> Function() task, String success) async {
    setState(() => _busy = true);
    try {
      await task();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(success)));
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<String?> _askReason(String title, String label) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          decoration: InputDecoration(labelText: label),
          maxLines: 2,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Onayla'),
          ),
        ],
      ),
    );
  }

  /// Randevudan müşterinin adisyonunu aç — Ön Muhasebe'ye gitmeden satış/ödeme/onay.
  /// Açık adisyon yoksa oluşturur, sonra adisyon detay sheet'ini açar.
  Future<void> _openAdisyon() async {
    final cid = '${appt['customerId'] ?? ''}'.trim();
    if (cid.isEmpty || cid.toLowerCase() == 'null') return;
    setState(() => _busy = true);
    try {
      final open = await widget.api.get('/api/admin/adisyonlar/open/$cid');
      String? id = open is Map ? '${open['id']}' : null;
      if (id == null || id.isEmpty || id == 'null') {
        final created = await widget.api.post('/api/admin/adisyonlar/', {
          'customerId': cid,
          'customerAccountId': null,
          'notes': null,
        });
        id = created is Map ? '${created['id']}' : null;
      }
      if (!mounted) return;
      setState(() => _busy = false);
      final adisyonId = id;
      if (adisyonId != null && adisyonId.isNotEmpty && adisyonId != 'null') {
        // Randevunun personeli adisyona taşınır: aynı kişi ikinci kez sorulmasın ve boş
        // bırakılıp prim/satış atfı kaybolmasın.
        final staffId = '${appt['staffMemberId'] ?? ''}'.trim();
        await showModalBottomSheet<bool>(
          context: context,
          isScrollControlled: true,
          useSafeArea: true,
          backgroundColor: Colors.transparent,
          builder: (_) => AdisyonDetailSheet(
            api: widget.api,
            adisyonId: adisyonId,
            defaultStaffMemberId:
                staffId.isEmpty || staffId.toLowerCase() == 'null' ? null : staffId,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  void _showCustomerProfile() {
    final c = customer;
    if (c == null) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Müşteri bilgisi yükleniyor...')));
      return;
    }
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              valueOf(c, const ['fullName']),
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            _profileRow(Icons.phone_rounded, valueOf(c, const ['phone'])),
            _profileRow(Icons.email_rounded, valueOf(c, const ['email'])),
            if (valueOf(c, const ['notes'], fallback: '').isNotEmpty)
              _profileRow(Icons.notes_rounded, valueOf(c, const ['notes'])),
            _profileRow(
              Icons.verified_user_rounded,
              c['kvkkConsent'] == true ? 'KVKK onayı var' : 'KVKK onayı yok',
            ),
          ],
        ),
      ),
    );
  }

  Widget _profileRow(IconData icon, String text) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(
      children: [
        Icon(icon, size: 18, color: AppColors.primaryDark),
        const SizedBox(width: 10),
        Expanded(child: Text(text)),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final status = '${appt['status']}';
    final start = _start;
    final price = appt['price'] as num?;
    final notes = valueOf(appt, const ['notes'], fallback: '');
    final phone = valueOf(customer ?? const {}, const ['phone'], fallback: '');
    final email = valueOf(customer ?? const {}, const ['email'], fallback: '');
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.9,
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 5,
                  margin: const EdgeInsets.only(bottom: 14),
                  decoration: BoxDecoration(
                    color: AppColors.border,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      color: const Color(0xFFEAF7EF),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Icon(
                      Icons.person_rounded,
                      color: Color(0xFF2A7A50),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                valueOf(appt, const ['customerName', 'fullName']),
                                style: const TextStyle(
                                  fontSize: 19,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            _StatusPill(status: status),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          valueOf(appt, const ['serviceName'], fallback: ''),
                          style: const TextStyle(color: AppColors.muted),
                        ),
                      ],
                    ),
                  ),
                  _CircleClose(onTap: () => Navigator.pop(context)),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: _InfoCell(
                      icon: Icons.calendar_today_rounded,
                      text: start == null
                          ? '—'
                          : CalendarText.longDate(start),
                    ),
                  ),
                  Expanded(
                    child: _InfoCell(
                      icon: Icons.access_time_rounded,
                      text: start == null || _end == null
                          ? '—'
                          : '${CalendarText.hm(start)} - ${CalendarText.hm(_end!)}$_durationText',
                    ),
                  ),
                  Expanded(
                    child: _InfoCell(
                      icon: Icons.person_outline_rounded,
                      text: valueOf(appt, const ['staffName'], fallback: '—'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              const _SectionLabel('Hizmet'),
              _SoftCard(
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        valueOf(appt, const ['serviceName'], fallback: '—'),
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    Text(
                      CalendarText.tl(price),
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                  ],
                ),
              ),
              if (notes.isNotEmpty) ...[
                const SizedBox(height: 16),
                const _SectionLabel('Not'),
                _SoftCard(child: Text(notes)),
              ],
              const SizedBox(height: 16),
              const _SectionLabel('İletişim Bilgileri'),
              _ContactRow(
                icon: Icons.phone_rounded,
                text: phone.isEmpty ? 'Yükleniyor...' : phone,
                trailing: phone.isEmpty
                    ? null
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _CallButton(
                            onTap: () => callCustomer(context, widget.api, appt['customerId']),
                          ),
                          const SizedBox(width: 8),
                          _ChatButton(
                            icon: Icons.copy_rounded,
                            onTap: () {
                              Clipboard.setData(ClipboardData(text: phone));
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Telefon kopyalandı.'),
                                ),
                              );
                            },
                          ),
                        ],
                      ),
              ),
              const SizedBox(height: 10),
              _ContactRow(
                icon: Icons.email_rounded,
                text: email.isEmpty ? '—' : email,
              ),
              const SizedBox(height: 18),
              // WHATSAPP HATIRLATMA + müşteri onay durumu (web AppointmentReminderControl).
              // Tamamlanmış/iptal randevuda hatırlatmanın anlamı yok.
              if (status != 'Completed' && status != 'Cancelled') ...[
                Builder(builder: (_) {
                  final meta = _confirmationMeta('${appt['customerConfirmation'] ?? 'None'}');
                  return Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: const Color(0xFF25D366).withValues(alpha: .07),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFF25D366).withValues(alpha: .3)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.chat_rounded, size: 18, color: Color(0xFF1DA851)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('WhatsApp hatırlatma',
                                  style: TextStyle(
                                      fontSize: 12.5, fontWeight: FontWeight.w700)),
                              if (meta != null)
                                Text('Müşteri: ${meta.$1}',
                                    style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                        color: meta.$2))
                              else
                                const Text('Henüz yanıt yok',
                                    style: TextStyle(fontSize: 11, color: AppColors.muted)),
                            ],
                          ),
                        ),
                        FilledButton.icon(
                          style: FilledButton.styleFrom(
                            backgroundColor: const Color(0xFF25D366),
                            minimumSize: const Size(0, 40),
                            visualDensity: VisualDensity.compact,
                          ),
                          onPressed: (_busy || _reminderBusy) ? null : _sendWhatsappReminder,
                          icon: _reminderBusy
                              ? const SizedBox(
                                  width: 13,
                                  height: 13,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.send_rounded, size: 15),
                          label: const Text('Hatırlat', style: TextStyle(fontSize: 12)),
                        ),
                      ],
                    ),
                  );
                }),
                const SizedBox(height: 10),
              ],

              // Şu an işlemde / işlemi bitir — duruma göre tek buton
              if (status == 'Scheduled' || status == 'Confirmed') ...[
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF8B5CF6),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    onPressed: _busy ? null : _startService,
                    icon: const Icon(Icons.auto_awesome_rounded, size: 20),
                    label: const Text('Şu an işlemde',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
                const SizedBox(height: 10),
              ] else if (status == 'InProgress') ...[
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF2A9D64),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    onPressed: _busy ? null : _complete,
                    icon: const Icon(Icons.check_circle_rounded, size: 20),
                    label: const Text('İşlemi bitir · Tamamlandı',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
                const SizedBox(height: 10),
              ],
              // YANLIŞ TAMAMLAMAYI GERİ AL — yalnız tamamlanmış randevuda ve ayrı yetkiyle.
              if (status == 'Completed' &&
                  (widget.api.auth?.user?.canAction(Perm.appointmentsVoidCompletion) ?? true)) ...[
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: TextButton.icon(
                    style: TextButton.styleFrom(
                      backgroundColor: AppColors.warning.withValues(alpha: .08),
                      foregroundColor: AppColors.warning,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                        side: BorderSide(
                            color: AppColors.warning.withValues(alpha: .35)),
                      ),
                    ),
                    onPressed: _busy ? null : _voidCompletion,
                    icon: const Icon(Icons.undo_rounded, size: 19),
                    label: const Text('Tamamlamayı Geri Al',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Bu randevuda tüketilen paket seansı müşteriye iade edilir ve randevu '
                  '"Onaylandı" durumuna döner. Tamamlama sırasında satış cariye işlendiyse '
                  'önce satışı iptal etmeniz gerekir.',
                  style: TextStyle(fontSize: 11.5, color: AppColors.muted),
                ),
                const SizedBox(height: 12),
              ],
              Row(
                children: [
                  Expanded(
                    child: _OutlineAction(
                      icon: Icons.edit_rounded,
                      label: 'Randevuyu Düzenle',
                      onTap: _busy ? null : _edit,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _OutlineAction(
                      icon: Icons.block_rounded,
                      label: 'Randevuyu İptal Et',
                      onTap: _busy ? null : _cancel,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              // KALICI SİLME — iptalden ayrı, en altta ve tehlikeli renkte.
              SizedBox(
                width: double.infinity,
                height: 46,
                child: TextButton.icon(
                  style: TextButton.styleFrom(
                    backgroundColor: AppColors.danger.withValues(alpha: .07),
                    foregroundColor: AppColors.danger,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                      side: BorderSide(color: AppColors.danger.withValues(alpha: .3)),
                    ),
                  ),
                  onPressed: _busy ? null : _delete,
                  icon: const Icon(Icons.delete_outline_rounded, size: 19),
                  label: const Text('Randevuyu Sil',
                      style: TextStyle(fontWeight: FontWeight.w700)),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: _busy ? null : _openAdisyon,
                  icon: const Icon(Icons.receipt_long_rounded, size: 20),
                  label: const Text(
                    'Adisyon / Ödeme al',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: TextButton.icon(
                  style: TextButton.styleFrom(
                    backgroundColor: const Color(0xFFF3F1F4),
                    foregroundColor: AppColors.ink,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: _showCustomerProfile,
                  icon: const Icon(Icons.person_outline_rounded, size: 20),
                  label: const Text(
                    'Müşteri Profili',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = CalendarText.statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        CalendarText.statusLabel(status),
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _CircleClose extends StatelessWidget {
  const _CircleClose({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: const Color(0xFFF3F1F4),
    shape: const CircleBorder(),
    child: InkWell(
      customBorder: const CircleBorder(),
      onTap: onTap,
      child: const SizedBox(
        width: 36,
        height: 36,
        child: Icon(Icons.close_rounded, size: 20),
      ),
    ),
  );
}

class _InfoCell extends StatelessWidget {
  const _InfoCell({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Icon(icon, size: 18, color: AppColors.primaryDark),
      const SizedBox(height: 6),
      Text(
        text,
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
      ),
    ],
  );
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      text,
      style: const TextStyle(
        fontWeight: FontWeight.w800,
        fontSize: 14,
        color: AppColors.ink,
      ),
    ),
  );
}

class _SoftCard extends StatelessWidget {
  const _SoftCard({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: const Color(0xFFF8F6F8),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: AppColors.border),
    ),
    child: child,
  );
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({required this.icon, required this.text, this.trailing});
  final IconData icon;
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            color: const Color(0xFFF8F6F8),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Icon(icon, size: 18, color: AppColors.primaryDark),
              const SizedBox(width: 10),
              Expanded(child: Text(text)),
            ],
          ),
        ),
      ),
      if (trailing != null) ...[const SizedBox(width: 10), trailing!],
    ],
  );
}

class _CallButton extends StatelessWidget {
  const _CallButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: AppColors.primary,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: const SizedBox(
        height: 50,
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.call_rounded, size: 18, color: Colors.white),
              SizedBox(width: 6),
              Text(
                'Ara',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _ChatButton extends StatelessWidget {
  const _ChatButton({
    required this.onTap,
    this.icon = Icons.chat_bubble_outline_rounded,
  });
  final VoidCallback onTap;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Material(
    color: AppColors.surfaceSoft,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(14),
      side: const BorderSide(color: AppColors.border),
    ),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: SizedBox(
        width: 50,
        height: 50,
        child: Icon(icon, color: AppColors.primary),
      ),
    ),
  );
}

class _OutlineAction extends StatelessWidget {
  const _OutlineAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 50,
    child: OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.primary,
        backgroundColor: AppColors.surfaceSoft,
        side: const BorderSide(color: Color(0xFFF3D3DE)),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
      ),
      onPressed: onTap,
      icon: Icon(icon, size: 18),
      label: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Edit sheet: reschedule + notes + status
// ---------------------------------------------------------------------------
class _EditSheet extends StatefulWidget {
  const _EditSheet({required this.api, required this.appointment});
  final ApiClient api;
  final Map<String, dynamic> appointment;

  @override
  State<_EditSheet> createState() => _EditSheetState();
}

class _EditSheetState extends State<_EditSheet> {
  late DateTime start;
  late int durationMinutes;
  late String status;
  late TextEditingController notes;
  bool saving = false;

  static const _statuses = [
    ['Scheduled', 'Planlandı'],
    ['Confirmed', 'Onaylandı'],
    ['InProgress', 'İşlemde'],
    ['Completed', 'Tamamlandı'],
    ['NoShow', 'Gelmedi'],
  ];

  @override
  void initState() {
    super.initState();
    final s = parseUtcToLocal(widget.appointment['startUtc']) ??
        DateTime.now();
    final e = parseUtcToLocal(widget.appointment['endUtc']) ??
        s.add(const Duration(hours: 1));
    start = s;
    durationMinutes = e.difference(s).inMinutes;
    final st = '${widget.appointment['status']}';
    status = _statuses.any((x) => x[0] == st) ? st : 'Scheduled';
    notes = TextEditingController(
      text: '${widget.appointment['notes'] ?? ''}',
    );
  }

  @override
  void dispose() {
    notes.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final date = await showDatePicker(
      context: context,
      initialDate: start,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 730)),
    );
    if (!mounted || date == null) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(start),
    );
    if (time == null) return;
    setState(() {
      start = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    });
  }

  Future<void> _save() async {
    setState(() => saving = true);
    final id = widget.appointment['id'];
    try {
      final end = start.add(Duration(minutes: durationMinutes));
      final prevStatus = '${widget.appointment['status']}';
      // TEK UÇ (web paritesi): zaman + durum + not aynı transaction'da. Üç ayrı çağrıda
      // durum başarılı olup not çağrısı patlarsa randevu tamamlanmış (ve seans düşmüş)
      // hâlde kalırken ekran "kaydedilemedi" gösteriyordu.
      await widget.api.patch('/api/admin/appointments/$id', {
        'startUtc': start.toUtc().toIso8601String(),
        'endUtc': end.toUtc().toIso8601String(),
        'status': status != prevStatus ? status : null,
        'statusReason': null,
        'notesProvided': true,
        'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
      });
      // Web ile aynı: randevu "Tamamlandı"ya geçince müşteri puanlama linki üret.
      if (status == 'Completed' && prevStatus != 'Completed') {
        try {
          final r = await widget.api.post('/api/ratings/issue', {'appointmentId': id});
          final token = r is Map ? r['token'] : null;
          if (mounted && token != null) {
            await showDialog<void>(
              context: context,
              builder: (ctx) => AlertDialog(
                title: const Text('Puanlama linki oluşturuldu'),
                content: SelectableText('Müşteriye iletin:\n/rate/$token'),
                actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Tamam'))],
              ),
            );
          }
        } catch (_) {
          /* puanlama linki üretilemese de randevu akışı bozulmasın */
        }
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => saving = false);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        18,
        20,
        MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Randevuyu düzenle',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 16),
            ListTile(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: const BorderSide(color: AppColors.border),
              ),
              leading: const Icon(Icons.event_rounded),
              title: const Text('Tarih ve saat'),
              subtitle: Text(
                '${CalendarText.longDate(start)}  ${CalendarText.hm(start)}',
              ),
              onTap: _pick,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: status,
              decoration: const InputDecoration(labelText: 'Durum'),
              items: _statuses
                  .map(
                    (s) => DropdownMenuItem(value: s[0], child: Text(s[1])),
                  )
                  .toList(),
              onChanged: (v) => setState(() => status = v ?? status),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: notes,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Not'),
            ),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: saving ? null : _save,
              child: Text(saving ? 'Kaydediliyor...' : 'Değişiklikleri kaydet'),
            ),
          ],
        ),
      ),
    );
  }
}
