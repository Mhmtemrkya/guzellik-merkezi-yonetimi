import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import 'kvkk_default.dart';
import 'kvkk_pdf.dart';

/// Kurumun KVKK metni + logosu + adı. Görüntüleme ve düzenleme sheet'leri kullanır.
class _KvkkData {
  const _KvkkData({this.name = 'Kurum', this.customText, this.logo});
  final String name;
  final String? customText;
  final String? logo;
}

Future<_KvkkData> _fetch(ApiClient api) async {
  Future<Map<String, dynamic>> g(String p) async {
    final r = await api.get(p).catchError((_) => <String, dynamic>{});
    return r is Map ? r.cast<String, dynamic>() : <String, dynamic>{};
  }

  final results = await Future.wait([g('/api/admin/tenant/'), g('/api/admin/tenant/public-profile')]);
  final tenant = results[0];
  final profile = results[1];
  final name = (tenant['name'] ?? tenant['tenantName'] ?? 'Kurum').toString();
  return _KvkkData(
    name: name.trim().isEmpty ? 'Kurum' : name.trim(),
    customText: (profile['kvkkConsentText'] as String?),
    logo: (profile['logoData'] as String?),
  );
}

/// Yeni müşteri ekranında "KVKK aydınlatma metnini görüntüle" ile açılan sheet.
/// Metin + not + markalı PDF indir/paylaş butonu.
Future<void> showKvkkViewSheet(BuildContext context, ApiClient api) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (ctx) => FutureBuilder<_KvkkData>(
      future: _fetch(api),
      builder: (ctx, snap) {
        final loading = snap.connectionState != ConnectionState.done;
        final data = snap.data ?? const _KvkkData();
        final text = resolveKvkkText(data.customText, data.name);
        return SizedBox(
          height: MediaQuery.sizeOf(ctx).height * 0.85,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 12, 6),
                child: Row(
                  children: [
                    const Icon(Icons.shield_rounded, color: AppColors.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('KVKK Aydınlatma Metni',
                              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                          Text(data.name, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                        ],
                      ),
                    ),
                    IconButton(onPressed: () => Navigator.pop(ctx), icon: const Icon(Icons.close_rounded)),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: loading
                    ? const Center(child: CircularProgressIndicator())
                    : SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(20, 14, 20, 14),
                        child: Text(text, style: const TextStyle(fontSize: 12.5, height: 1.5)),
                      ),
              ),
              const Divider(height: 1),
              Padding(
                padding: EdgeInsets.fromLTRB(16, 10, 16, MediaQuery.viewInsetsOf(ctx).bottom + 14),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text('Metni Ayarlar ekranından düzenleyebilirsiniz.',
                          style: TextStyle(fontSize: 11, color: AppColors.muted)),
                    ),
                    FilledButton.icon(
                      onPressed: loading
                          ? null
                          : () async {
                              try {
                                await KvkkPdf.share(institutionName: data.name, text: text, logoBase64: data.logo);
                              } catch (e) {
                                if (ctx.mounted) {
                                  ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('PDF oluşturulamadı: $e')));
                                }
                              }
                            },
                      icon: const Icon(Icons.download_rounded, size: 18),
                      label: const Text('PDF indir'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    ),
  );
}

/// Ayarlar ekranında KVKK metnini düzenleme sheet'i.
/// Kaydet (varsayılana eşitse null gönderir), varsayılana dön, PDF önizle.
Future<bool> showKvkkEditorSheet(BuildContext context, ApiClient api) async {
  final data = await _fetch(api);
  final controller = TextEditingController(text: kvkkEditorInitial(data.customText));
  var saved = false;

  if (!context.mounted) {
    controller.dispose();
    return false;
  }

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (ctx) {
      var busy = false;
      return StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.viewInsetsOf(ctx).bottom + 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.shield_rounded, color: AppColors.primaryDark),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text('KVKK Aydınlatma Metni',
                        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  ),
                  IconButton(onPressed: () => Navigator.pop(ctx), icon: const Icon(Icons.close_rounded)),
                ],
              ),
              const Text('{KURUM} yazdığınız yere kurum adı otomatik yerleşir.',
                  style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
              const SizedBox(height: 12),
              Flexible(
                child: SingleChildScrollView(
                  child: TextField(
                    controller: controller,
                    maxLines: null,
                    minLines: 10,
                    style: const TextStyle(fontSize: 12.5, height: 1.4),
                    decoration: InputDecoration(
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      contentPadding: const EdgeInsets.all(12),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: busy
                          ? null
                          : () async {
                              setSheet(() => busy = true);
                              try {
                                final v = controller.text;
                                final payload = v.trim() == kDefaultKvkkText.trim() ? null : v;
                                await api.put('/api/admin/tenant/public-profile/kvkk', {'text': payload});
                                saved = true;
                                if (ctx.mounted) Navigator.pop(ctx);
                              } catch (e) {
                                setSheet(() => busy = false);
                                if (ctx.mounted) {
                                  ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('$e')));
                                }
                              }
                            },
                      icon: const Icon(Icons.save_rounded, size: 18),
                      label: Text(busy ? 'Kaydediliyor...' : 'Metni kaydet'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    tooltip: 'PDF önizle',
                    onPressed: () async {
                      try {
                        await KvkkPdf.share(
                          institutionName: data.name,
                          text: resolveKvkkText(controller.text, data.name),
                          logoBase64: data.logo,
                        );
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('PDF oluşturulamadı: $e')));
                        }
                      }
                    },
                    icon: const Icon(Icons.download_rounded),
                  ),
                  IconButton(
                    tooltip: 'Varsayılana dön',
                    onPressed: () => setSheet(() => controller.text = kDefaultKvkkText),
                    icon: const Icon(Icons.restore_rounded),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
    },
  );

  controller.dispose();
  return saved;
}
