import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';

// ---------------------------------------------------------------------------
// MAAŞ ÖDEME  (web `SalaryPaymentDialog` paritesi)
// Personel kartlardan seçilir — bu dönemde ne ödendiği kartın üstünde görünür.
// Tutar + dönem + yöntem girilir; kayıt gider olarak kasaya işlenir.
// ---------------------------------------------------------------------------

const _salaryMethods = [
  ('BankTransfer', 'Havale / EFT'),
  ('Cash', 'Nakit'),
  ('Card', 'Kart'),
];

String _initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
  if (parts.isEmpty) return '•';
  return parts.take(2).map((p) => p[0].toUpperCase()).join();
}

class SalaryPaymentSheet extends StatefulWidget {
  const SalaryPaymentSheet({
    required this.staff,
    required this.salaryExpenses,
    required this.defaultPeriod,
    super.key,
  });

  final List<Map<String, dynamic>> staff;

  /// Dönemdeki maaş giderleri — "bu dönem ödendi" rozetini besler.
  final List<Map<String, dynamic>> salaryExpenses;
  final String defaultPeriod;

  @override
  State<SalaryPaymentSheet> createState() => _SalaryPaymentSheetState();
}

class _SalaryPaymentSheetState extends State<SalaryPaymentSheet> {
  String _staffId = '';
  String _query = '';
  String _method = 'BankTransfer';
  bool _advance = false;
  String? _error;
  DateTime _date = DateTime.now();
  final _amount = TextEditingController();
  late final TextEditingController _period = TextEditingController(
    text: widget.defaultPeriod,
  );

  @override
  void dispose() {
    _amount.dispose();
    _period.dispose();
    super.dispose();
  }

  /// Personel başına bu dönemde ödenen toplam.
  Map<String, double> get _paidByStaff {
    final map = <String, double>{};
    for (final e in widget.salaryExpenses) {
      final key = '${e['staffMemberId'] ?? ''}';
      if (key.isEmpty || key == 'null') continue;
      map[key] = (map[key] ?? 0) + ((e['amount'] as num?)?.toDouble() ?? 0);
    }
    return map;
  }

  void _submit() {
    setState(() => _error = null);
    if (_staffId.isEmpty) {
      setState(() => _error = 'Personel seçimi zorunlu.');
      return;
    }
    final amount = double.tryParse(_amount.text.trim().replaceAll(',', '.'));
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Tutar 0’dan büyük olmalı.');
      return;
    }
    Navigator.pop(context, <String, dynamic>{
      'category': 'Salary',
      'staffMemberId': _staffId,
      'amount': amount,
      'paymentMethod': _method,
      'periodLabel': _period.text.trim(),
      'occurredAtUtc': _date.toUtc().toIso8601String(),
      'description': _advance ? 'Avans' : 'Aylık maaş',
    });
  }

  @override
  Widget build(BuildContext context) {
    final paid = _paidByStaff;
    final q = _query.trim().toLowerCase();
    final staff = q.isEmpty
        ? widget.staff
        : widget.staff.where((s) {
            final text =
                '${valueOf(s, const ['fullName', 'name'])} '
                        '${valueOf(s, const ['title', 'role'], fallback: '')}'
                    .toLowerCase();
            return text.contains(q);
          }).toList();

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.92,
      ),
      clipBehavior: Clip.antiAlias,
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // ---- Başlık ----
            Container(
              padding: const EdgeInsets.fromLTRB(18, 14, 8, 14),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Color(0xFFF8F4FF),
                    Color(0xFFFFFFFF),
                    Color(0xFFFFF2F6),
                  ],
                ),
                border: Border(bottom: BorderSide(color: Color(0xFFF2E2E9))),
              ),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(13),
                      border: Border.all(color: const Color(0xFFDDD0F5)),
                    ),
                    child: const Icon(
                      Icons.groups_rounded,
                      color: Color(0xFF6B45C0),
                      size: 21,
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Personel maaşı öde',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Ödeme gider olarak kasaya işlenir, Maaşlar sekmesinde listelenir.',
                          style: TextStyle(
                            fontSize: 11,
                            color: AppColors.muted,
                            height: 1.3,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),

            // ---- Gövde ----
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: EdgeInsets.fromLTRB(
                  18,
                  14,
                  18,
                  MediaQuery.viewInsetsOf(context).bottom + 14,
                ),
                children: [
                  _label(Icons.groups_rounded, 'Personel'),
                  if (widget.staff.length > 6) ...[
                    const SizedBox(height: 6),
                    TextField(
                      decoration: const InputDecoration(
                        prefixIcon: Icon(Icons.search_rounded, size: 18),
                        hintText: 'Personel ara',
                        isDense: true,
                      ),
                      onChanged: (v) => setState(() => _query = v),
                    ),
                  ],
                  const SizedBox(height: 8),
                  if (staff.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 14),
                      child: Text(
                        'Personel bulunamadı.',
                        style: TextStyle(color: AppColors.muted, fontSize: 12),
                      ),
                    ),
                  for (final s in staff)
                    _staffCard(s, paid['${s['id']}'] ?? 0),

                  const SizedBox(height: 14),
                  _label(Icons.payments_rounded, 'Tutar'),
                  const SizedBox(height: 6),
                  TextField(
                    controller: _amount,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      hintText: '0',
                      prefixText: '₺ ',
                      isDense: true,
                    ),
                  ),

                  const SizedBox(height: 14),
                  _label(Icons.account_balance_rounded, 'Ödeme yöntemi'),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children: [
                      for (final m in _salaryMethods)
                        ChoiceChip(
                          label: Text(m.$2),
                          selected: _method == m.$1,
                          onSelected: (_) => setState(() => _method = m.$1),
                        ),
                    ],
                  ),

                  const SizedBox(height: 14),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _label(Icons.event_note_rounded, 'Dönem'),
                            const SizedBox(height: 6),
                            TextField(
                              controller: _period,
                              decoration: const InputDecoration(isDense: true),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _label(Icons.calendar_today_rounded, 'Ödeme tarihi'),
                            const SizedBox(height: 6),
                            OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                minimumSize: const Size.fromHeight(48),
                                side: const BorderSide(color: AppColors.border),
                                foregroundColor: AppColors.ink,
                              ),
                              onPressed: () async {
                                final picked = await showDatePicker(
                                  context: context,
                                  initialDate: _date,
                                  firstDate: DateTime(_date.year - 3),
                                  lastDate: DateTime(_date.year + 3),
                                );
                                if (picked != null) {
                                  setState(() => _date = picked);
                                }
                              },
                              child: Text(
                                DateFormat('d MMM yyyy', 'tr_TR').format(_date),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 6),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    value: _advance,
                    onChanged: (v) => setState(() => _advance = v),
                    title: const Text(
                      'Avans ödemesi',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    subtitle: const Text(
                      'Açıklama "Avans" olarak kaydedilir.',
                      style: TextStyle(fontSize: 11, color: AppColors.muted),
                    ),
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 11,
                        vertical: 9,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFECF1),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFF4C6D3)),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.error_outline_rounded,
                            size: 16,
                            color: Color(0xFFC0405F),
                          ),
                          const SizedBox(width: 7),
                          Expanded(
                            child: Text(
                              _error!,
                              style: const TextStyle(
                                fontSize: 11.5,
                                color: Color(0xFFC0405F),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),

            // ---- Aksiyonlar ----
            Container(
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 12),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: Color(0xFFF2E2E9))),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(50),
                      ),
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Vazgeç'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: _submit,
                      icon: const Icon(Icons.check_rounded),
                      label: const Text('Ödemeyi kaydet'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _label(IconData icon, String text) => Row(
    children: [
      Icon(icon, size: 14, color: const Color(0xFF6B45C0)),
      const SizedBox(width: 6),
      Text(
        text,
        style: const TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w800,
          color: Color(0xFF7E5F6E),
        ),
      ),
    ],
  );

  Widget _staffCard(Map<String, dynamic> s, double paid) {
    final id = '${s['id'] ?? ''}';
    final selected = _staffId == id;
    final name = valueOf(s, const ['fullName', 'name'], fallback: 'Personel');
    final role = valueOf(s, const ['title', 'role'], fallback: '');

    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Material(
        color: selected ? const Color(0xFFF5F0FF) : AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => setState(() => _staffId = selected ? '' : id),
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: selected ? const Color(0xFF9B7BE0) : AppColors.border,
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFEFE7FF), Color(0xFFE0D3FF)],
                    ),
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Text(
                    _initials(name),
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 12,
                      color: Color(0xFF6B45C0),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 13,
                        ),
                      ),
                      if (role.isNotEmpty)
                        Text(
                          role,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.muted,
                          ),
                        ),
                    ],
                  ),
                ),
                if (paid > 0)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFE6F7EE),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '${CalendarText.tl(paid)} ödendi',
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF2F7D54),
                      ),
                    ),
                  ),
                if (selected)
                  const Padding(
                    padding: EdgeInsets.only(left: 6),
                    child: Icon(
                      Icons.check_circle_rounded,
                      size: 18,
                      color: Color(0xFF6B45C0),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
