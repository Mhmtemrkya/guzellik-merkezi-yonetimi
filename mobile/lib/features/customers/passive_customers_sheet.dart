import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';

/// PASİF MÜŞTERİLER — web `PassiveCustomersPanel` paritesi.
///
/// Mobil dashboard'da yalnızca sayı görünüyordu; kimlerin gelmediği ve eşiğin kaç gün olduğu
/// bilinmiyordu. Burada isim listesi, son ziyaretten bu yana geçen gün ve eşik ayarı var.
/// Kapanırken true döner => çağıran pano tazelenir (eşik değişmiş olabilir).
class PassiveCustomersSheet extends StatefulWidget {
  const PassiveCustomersSheet({required this.api, super.key});
  final ApiClient api;

  @override
  State<PassiveCustomersSheet> createState() => _PassiveCustomersSheetState();
}

class _PassiveCustomersSheetState extends State<PassiveCustomersSheet> {
  late Future<Map<String, dynamic>> _future;
  final _days = TextEditingController();
  bool _saving = false;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _days.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _load() async {
    final res = await widget.api
        .get('/api/admin/customers/passive')
        .catchError((_) => const <String, dynamic>{});
    final map = res is Map ? res.cast<String, dynamic>() : <String, dynamic>{};
    final threshold = numberOf(map, const ['thresholdDays']).toInt();
    if (threshold > 0) _days.text = '$threshold';
    return map;
  }

  Future<void> _saveThreshold() async {
    final value = int.tryParse(_days.text.trim());
    if (value == null || value < 1) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Gün sayısı 1 veya daha büyük olmalı.')));
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.api.put('/api/admin/customers/passive-threshold', {'days': value});
      _changed = true;
      setState(() => _future = _load());
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Eşik $value gün olarak kaydedildi.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: true,
      onPopInvokedWithResult: (didPop, _) {},
      child: Padding(
        padding: EdgeInsets.fromLTRB(
            18, 16, 18, MediaQuery.viewInsetsOf(context).bottom + 24),
        child: FutureBuilder<Map<String, dynamic>>(
          future: _future,
          builder: (context, snapshot) {
            if (!snapshot.hasData && !snapshot.hasError) {
              return const SizedBox(
                  height: 260, child: Center(child: CircularProgressIndicator()));
            }
            final data = snapshot.data ?? const <String, dynamic>{};
            final items = apiItems(data);
            final threshold = numberOf(data, const ['thresholdDays']).toInt();

            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: .10),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.nightlight_round,
                          color: AppColors.primaryDark, size: 20),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Pasif müşteriler',
                              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          Text(
                            items.isEmpty
                                ? 'Son $threshold gün içinde herkesin işlemi var.'
                                : '${items.length} müşteri $threshold+ gündür işlemsiz',
                            style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),

                // Eşik ayarı
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSoft,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'Kaç gündür işlemi olmayan müşteri pasif sayılsın?',
                          style: TextStyle(fontSize: 12),
                        ),
                      ),
                      const SizedBox(width: 10),
                      SizedBox(
                        width: 64,
                        child: TextField(
                          controller: _days,
                          keyboardType: TextInputType.number,
                          textAlign: TextAlign.center,
                          decoration: const InputDecoration(
                            isDense: true,
                            contentPadding:
                                EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: _saving ? null : _saveThreshold,
                        style: FilledButton.styleFrom(
                            visualDensity: VisualDensity.compact),
                        child: Text(_saving ? '...' : 'Kaydet',
                            style: const TextStyle(fontSize: 12)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                if (items.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 30),
                    child: Center(
                      child: Text('Pasif müşteri yok.',
                          style: TextStyle(color: AppColors.muted)),
                    ),
                  ),
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final p in items)
                        InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () {
                            Navigator.pop(context, _changed);
                            // Zengin müşteri detayı — rota `extra` ile müşteri bilgisini alır.
                            context.push('/customer-detail', extra: {
                              'customerId': '${p['id']}',
                              'customer': p,
                            });
                          },
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppColors.surface,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppColors.border),
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        valueOf(p, const ['fullName', 'name'],
                                            fallback: 'Müşteri'),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w700, fontSize: 13),
                                      ),
                                      Text(
                                        valueOf(p, const ['phone'], fallback: ''),
                                        style: const TextStyle(
                                            fontSize: 11, color: AppColors.muted),
                                      ),
                                    ],
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: AppColors.warning.withValues(alpha: .12),
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                  child: Text(
                                    '${numberOf(p, const ['daysSinceActivity']).toInt()} gün',
                                    style: const TextStyle(
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w800,
                                        color: AppColors.warning),
                                  ),
                                ),
                                const Icon(Icons.chevron_right_rounded,
                                    size: 18, color: AppColors.muted),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
