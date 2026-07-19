import '../../core/network/api_client.dart';
import '../json_helpers.dart';
import 'crud_screen.dart';

/// Reusable async option loaders for entity-reference dropdowns.
class CrudOptions {
  const CrudOptions(this.api);
  final ApiClient api;

  Future<List<CrudOption>> customers() async {
    final data = await api.getAllPaged('/api/admin/customers/');
    return apiItems(data)
        .map(
          // Aynı isimli müşterileri ayırt etmek için telefon da etikette görünür.
          (c) => CrudOption(
            c['id'],
            '${c['phone'] ?? ''}'.isEmpty
                ? valueOf(c, const ['fullName', 'name'])
                : '${valueOf(c, const ['fullName', 'name'])} · ${c['phone']}',
          ),
        )
        .toList();
  }

  Future<List<CrudOption>> staff() async {
    final data = await api.get(
      '/api/admin/staff/',
      query: {'page': 1, 'pageSize': 200},
    );
    return apiItems(data)
        .map(
          (s) => CrudOption(
            s['id'],
            valueOf(s, const ['fullName', 'name', 'displayName']),
          ),
        )
        .toList();
  }

  Future<List<CrudOption>> services() async {
    final data = await api.get(
      '/api/admin/services/',
      query: {'page': 1, 'pageSize': 200},
    );
    return apiItems(
      data,
    ).map((s) => CrudOption(s['id'], valueOf(s, const ['name']))).toList();
  }

  Future<List<CrudOption>> serviceSpecialties() async {
    final data = await api.get(
      '/api/admin/services/',
      query: {'page': 1, 'pageSize': 200},
    );
    final names = <String>{};
    for (final service in apiItems(data)) {
      final name = valueOf(service, const ['name'], fallback: '').trim();
      if (name.isNotEmpty) names.add(name);
    }
    return names.map((name) => CrudOption(name, name)).toList();
  }

  Future<List<CrudOption>> branches() async {
    final data = await api.get('/api/admin/branches/');
    return apiItems(data)
        .map((b) => CrudOption(b['id'], valueOf(b, const ['name', 'city'])))
        .toList();
  }

  /// Personel sayfa-bazlı yetki kataloğu (web ile birebir): value=izin anahtarı, label=Türkçe ad.
  Future<List<CrudOption>> staffPermissions() async {
    final data = await api.get('/api/admin/staff/permissions');
    return apiItems(data)
        .map((p) => CrudOption(p['key'], valueOf(p, const ['label', 'key'])))
        .toList();
  }
}
