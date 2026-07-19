import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';

/// Müşteri seçtiren alt sayfa — menüden bağlamsız açılan müşteri-özel ekranlar
/// (Konsültasyon, Tedavi Günlüğü) ve form içi aramalı seçim için.
/// Seçilen müşterinin (id, ad, telefon) kaydını döndürür; iptalde null.
Future<({String id, String name, String phone})?> pickCustomer(
  BuildContext context,
  ApiClient api,
) {
  return showModalBottomSheet<({String id, String name, String phone})>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => _CustomerPickerSheet(api: api),
  );
}

/// Form içi aramalı müşteri alanı — binlerce kayıtta dropdown yerine
/// [pickCustomer] alt sayfasını açar; seçili adın yanında telefon görünür.
class CustomerSelectField extends StatefulWidget {
  const CustomerSelectField({
    required this.api,
    required this.onSelected,
    this.label = 'Müşteri',
    super.key,
  });
  final ApiClient api;
  final String label;
  final void Function(({String id, String name, String phone}) picked)
      onSelected;

  @override
  State<CustomerSelectField> createState() => _CustomerSelectFieldState();
}

class _CustomerSelectFieldState extends State<CustomerSelectField> {
  ({String id, String name, String phone})? _picked;

  @override
  Widget build(BuildContext context) {
    final picked = _picked;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () async {
        final result = await pickCustomer(context, widget.api);
        if (result != null) {
          setState(() => _picked = result);
          widget.onSelected(result);
        }
      },
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: widget.label,
          suffixIcon: const Icon(Icons.search_rounded, size: 20),
        ),
        isEmpty: picked == null,
        child: picked == null
            ? const Text('Ara ve seç…', style: TextStyle(color: Colors.black38))
            : Row(
                children: [
                  Flexible(
                    child: Text(picked.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                  if (picked.phone.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Text(picked.phone,
                        style: const TextStyle(
                            fontSize: 12.5, color: Colors.black54)),
                  ],
                ],
              ),
      ),
    );
  }
}

class _CustomerPickerSheet extends StatefulWidget {
  const _CustomerPickerSheet({required this.api});
  final ApiClient api;

  @override
  State<_CustomerPickerSheet> createState() => _CustomerPickerSheetState();
}

class _CustomerPickerSheetState extends State<_CustomerPickerSheet> {
  late Future<List<Map<String, dynamic>>> _future;
  String _q = '';

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final res = await widget.api.getAllPaged('/api/admin/customers/');
    return apiItems(res);
  }

  @override
  Widget build(BuildContext context) {
    final h = MediaQuery.sizeOf(context).height;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: h * 0.82,
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 14, 20, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Müşteri seç',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: 'Ad veya telefon ara…',
                  prefixIcon: const Icon(Icons.search_rounded, size: 18),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 6),
            Expanded(
              child: FutureBuilder<List<Map<String, dynamic>>>(
                future: _future,
                builder: (context, snap) {
                  if (!snap.hasData && !snap.hasError) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snap.hasError) {
                    return Center(child: Text('${snap.error}'));
                  }
                  final all = snap.data!;
                  final list = _q.isEmpty
                      ? all
                      : all.where((c) {
                          final name = valueOf(c, const ['fullName', 'name'],
                                  fallback: '')
                              .toLowerCase();
                          final phone = '${c['phone'] ?? ''}';
                          return name.contains(_q) || phone.contains(_q);
                        }).toList();
                  if (list.isEmpty) {
                    return const Center(
                      child: Text('Müşteri bulunamadı.',
                          style: TextStyle(color: AppColors.muted)),
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
                    itemCount: list.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 6),
                    itemBuilder: (_, i) {
                      final c = list[i];
                      final name = valueOf(c, const ['fullName', 'name']);
                      final id = '${c['id']}';
                      return Card(
                        margin: EdgeInsets.zero,
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: AppColors.rose,
                            child: Text(
                              _initials(name),
                              style: const TextStyle(
                                color: AppColors.primaryDark,
                                fontWeight: FontWeight.w900,
                                fontSize: 12,
                              ),
                            ),
                          ),
                          title: Text(name,
                              style:
                                  const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text('${c['phone'] ?? ''}'),
                          onTap: () => Navigator.pop(context,
                              (id: id, name: name, phone: '${c['phone'] ?? ''}')),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _initials(String name) {
  final p = name.trim().split(RegExp(r'\s+')).where((e) => e.isNotEmpty).toList();
  if (p.isEmpty) return '?';
  return p.take(2).map((e) => e[0].toUpperCase()).join();
}
