import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';

/// KATALOG DİLİ (mobil) — Hizmetler ve Paketler ekranlarının ortak kabuğu.
///
/// Web'deki `components/dashboard/CatalogKit.tsx` ile birebir aynı kararlar:
///
///  1. **Sayaç = süzgeç.** Durum sayaçları ayrı KPI kartı değil, doğrudan basılan
///     süzgeçtir; böylece "3 kart + 5 sekme" tekrarı ortadan kalkar.
///  2. **Ağır içerik sayfada değil, sayfanın altından açılan sayfada (sheet).**
///  3. **Uydurma sayı yok.** Bu kit yalnız gösterim yapar; ekran yalnızca kaydın
///     KENDİ alanlarını geçirir. Tahmini kâr / kapsamı kesilmiş listeden türetilen
///     "toplam rezervasyon" gibi rakamlar web'de kaldırıldı, mobile hiç girmedi.
///
/// Renk kaynağı tek: [AppColors]. Ekranlarda ham hex yazmak, webde yapılan bir
/// düzeltmenin mobile geçmemesini üretir.

/// Katalog durumu → Türkçe etiket.
String catalogStatusLabel(String? status) {
  switch (status ?? '') {
    case 'Active':
      return 'Aktif';
    case 'Passive':
      return 'Pasif';
    case 'Draft':
      return 'Taslak';
    case 'Archived':
      return 'Arşiv';
    case 'Cancelled':
      return 'İptal';
    default:
      return 'Aktif';
  }
}

/// Durum renkleri paletin DIŞINDADIR (yeşil/amber/kırmızı ayrımı bilinçli korunur).
Color catalogStatusColor(String? status) {
  switch (status ?? '') {
    case 'Active':
      return AppColors.success;
    case 'Draft':
      return AppColors.warning;
    case 'Cancelled':
      return AppColors.danger;
    case 'Archived':
      return AppColors.border;
    default:
      return AppColors.violet;
  }
}

/// API kaydından durum anahtarını okur (`status` yoksa `isActive`'e düşer).
String catalogStatusOf(Map<String, dynamic> item) {
  final raw = '${item['status'] ?? ''}'.trim();
  if (raw.isNotEmpty && raw != 'null') return raw;
  return item['isActive'] == false ? 'Passive' : 'Active';
}

/// Sayfalı uçtan TÜM kayıtları çeker — tek sayfa tavanına takılıp katalog eksik görünmesin.
Future<List<Map<String, dynamic>>> fetchAllCatalogPages(
  ApiClient api,
  String path, {
  int pageSize = 200,
  int maxPages = 40,
}) async {
  final out = <Map<String, dynamic>>[];
  for (var page = 1; page <= maxPages; page++) {
    final data = await api.get(path, query: {'page': page, 'pageSize': pageSize});
    final batch = apiItems(data);
    out.addAll(batch);
    final total = data is Map ? (data['total'] ?? data['totalCount']) : null;
    if (batch.isEmpty) break;
    if (total is num && out.length >= total.toInt()) break;
    if (batch.length < pageSize) break;
  }
  return out;
}

/// Personelin uzmanlık alanı bu hizmeti kapsıyor mu?
///
/// Web'deki `staffCanPerform` kuralının birebir aynısı: uzmanlık listesi BOŞSA kısıt
/// yoktur (true), doluysa kategori ya da hizmet adı listede geçmelidir.
bool staffCanPerform(String? specialties, String? category, String? serviceName) {
  final list = (specialties ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .where((e) => e.isNotEmpty)
      .toList();
  if (list.isEmpty) return true;
  final cat = (category ?? '').trim().toLowerCase();
  final name = (serviceName ?? '').trim().toLowerCase();
  return (cat.isNotEmpty && list.contains(cat)) || (name.isNotEmpty && list.contains(name));
}

/// Sayfanın tepesindeki tek kart: marka bandında toplam rakam ve katalog gerçekleri,
/// altında durum sayaçları (basılınca süzer).
class CatalogOverviewCard extends StatelessWidget {
  const CatalogOverviewCard({
    required this.icon,
    required this.eyebrow,
    required this.total,
    required this.totalLabel,
    required this.facts,
    required this.segments,
    super.key,
  });

  final IconData icon;
  final String eyebrow;
  final int total;
  final String totalLabel;

  /// Yalnızca kataloğun KENDİ gerçekleri (tanımlı kayıtlardan doğrudan okunur).
  final List<({String label, String value})> facts;
  final Widget segments;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Marka bandı — dolu renk (tint değil), üzerindeki yazı beyaz.
          Container(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
            decoration: const BoxDecoration(color: AppColors.primary),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .2),
                        borderRadius: BorderRadius.circular(11),
                      ),
                      child: Icon(icon, size: 18, color: Colors.white),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        eyebrow.toUpperCase(),
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: .92),
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.6,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      '$total',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 38,
                        height: 1,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -1,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      totalLabel,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: .9),
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                if (facts.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final fact in facts)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: .2),
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: Text(
                            '${fact.label}: ${fact.value}',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 13, 14, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 30,
                      height: 30,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppColors.rose.withValues(alpha: .35),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.tune_rounded, size: 16, color: AppColors.primaryDark),
                    ),
                    const SizedBox(width: 9),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Katalog durumu',
                            style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w800,
                              color: AppColors.ink,
                            ),
                          ),
                          Text(
                            'Bir duruma dokunun, liste anında süzülsün.',
                            style: TextStyle(fontSize: 11.5, color: AppColors.muted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 11),
                segments,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Durum sayaçları — sayaç ve süzgeç tek nesnedir.
class CatalogSegments extends StatelessWidget {
  const CatalogSegments({
    required this.value,
    required this.options,
    required this.onChanged,
    super.key,
  });

  final String value;
  final List<({String key, String label, int count})> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 7,
      runSpacing: 7,
      children: [
        for (final option in options)
          _Segment(
            label: option.label,
            count: option.count,
            active: value == option.key,
            onTap: () => onChanged(option.key),
          ),
      ],
    );
  }
}

class _Segment extends StatelessWidget {
  const _Segment({
    required this.label,
    required this.count,
    required this.active,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? AppColors.primary : AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: active ? AppColors.primaryDark : AppColors.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '$count',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: active ? Colors.white : AppColors.ink,
                ),
              ),
              const SizedBox(width: 5),
              Text(
                label,
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: active ? Colors.white : const Color(0xFF5A4B53),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Arama kutusu — katalog araç çubuğunun tek alanı.
class CatalogSearchField extends StatelessWidget {
  const CatalogSearchField({
    required this.controller,
    required this.hint,
    required this.onChanged,
    super.key,
  });

  final TextEditingController controller;
  final String hint;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
      decoration: InputDecoration(
        isDense: true,
        hintText: hint,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        prefixIcon: const Icon(Icons.search_rounded, size: 19, color: AppColors.muted),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.close_rounded, size: 18, color: AppColors.muted),
                onPressed: () {
                  controller.clear();
                  onChanged('');
                },
              ),
      ),
    );
  }
}

/// Yatay kategori şeridi — "Tümü" + kategori adları (sayacıyla).
class CatalogCategoryStrip extends StatelessWidget {
  const CatalogCategoryStrip({
    required this.value,
    required this.options,
    required this.total,
    required this.onChanged,
    super.key,
  });

  final String value;
  final List<({String name, int count})> options;
  final int total;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 34,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          _pill('Tümü', total, value.isEmpty, () => onChanged('')),
          for (final option in options)
            _pill(option.name, option.count, value == option.name, () => onChanged(option.name)),
        ],
      ),
    );
  }

  Widget _pill(String label, int count, bool active, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(right: 7),
      child: Material(
        color: active ? AppColors.rose.withValues(alpha: .4) : AppColors.surface,
        borderRadius: BorderRadius.circular(99),
        child: InkWell(
          borderRadius: BorderRadius.circular(99),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(99),
              border: Border.all(color: active ? AppColors.primaryDark : AppColors.border),
            ),
            child: Text(
              '$label · $count',
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: active ? AppColors.primaryDark : const Color(0xFF5A4B53),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Katalog kartı — solda ince durum şeridi, içerik çağırana ait.
class CatalogCard extends StatelessWidget {
  const CatalogCard({
    required this.status,
    required this.child,
    required this.onTap,
    this.onLongPress,
    this.selected = false,
    super.key,
  });

  final String status;
  final Widget child;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        onLongPress: onLongPress,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: selected ? AppColors.primaryDark : AppColors.border,
              width: selected ? 1.6 : 1,
            ),
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(width: 3.5, color: catalogStatusColor(status)),
                Expanded(child: child),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Kart içindeki etiketli değer (süre / fiyat / seans gibi).
class CatalogMeta extends StatelessWidget {
  const CatalogMeta({required this.label, required this.value, super.key});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label.toUpperCase(),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
            letterSpacing: .6,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w800,
            color: AppColors.ink,
          ),
        ),
      ],
    );
  }
}

/// Nötr etiket (kategori, içerik parçası…).
class CatalogChip extends StatelessWidget {
  const CatalogChip(this.label, {this.tone, super.key});
  final String label;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final color = tone ?? const Color(0xFF5A4B53);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: tone == null ? AppColors.surfaceSoft : color.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: tone == null ? AppColors.border : color.withValues(alpha: .3)),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }
}

/// Durum rozeti — kart ve detay sayfasında ortak.
class CatalogStatusPill extends StatelessWidget {
  const CatalogStatusPill(this.status, {super.key});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = catalogStatusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: color.withValues(alpha: .32)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            catalogStatusLabel(status),
            style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: color),
          ),
        ],
      ),
    );
  }
}

/// Detay sayfasındaki başlıklı bölüm.
class CatalogSection extends StatelessWidget {
  const CatalogSection({
    required this.title,
    required this.child,
    this.hint,
    this.trailing,
    super.key,
  });

  final String title;
  final String? hint;
  final Widget? trailing;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
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
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                    if (hint != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        hint!,
                        style: const TextStyle(
                          fontSize: 11.5,
                          height: 1.35,
                          color: Color(0xFF705A66),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: 11),
          child,
        ],
      ),
    );
  }
}

/// Etiketli tek gerçek (katalog kaydından doğrudan okunur).
class CatalogFact extends StatelessWidget {
  const CatalogFact({required this.label, required this.value, super.key});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label.toUpperCase(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: AppColors.muted,
              letterSpacing: .6,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
        ],
      ),
    );
  }
}

/// Kayıt yok / eşleşme yok görünümü.
class CatalogEmpty extends StatelessWidget {
  const CatalogEmpty({
    required this.icon,
    required this.title,
    required this.hint,
    this.action,
    super.key,
  });

  final IconData icon;
  final String title;
  final String hint;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 34),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 22, color: AppColors.primary),
          ),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            hint,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, height: 1.4, color: Color(0xFF705A66)),
          ),
          if (action != null) ...[const SizedBox(height: 14), action!],
        ],
      ),
    );
  }
}

/// Toplu seçim çubuğu — seçim varken ekranın altında belirir (web paritesi).
class CatalogBulkBar extends StatelessWidget {
  const CatalogBulkBar({
    required this.count,
    required this.itemLabel,
    required this.onClear,
    required this.onDelete,
    this.busy = false,
    super.key,
  });

  final int count;
  final String itemLabel;
  final VoidCallback onClear;
  final VoidCallback onDelete;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
      decoration: BoxDecoration(
        color: AppColors.ink,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '$count $itemLabel seçildi',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          TextButton(
            onPressed: busy ? null : onClear,
            style: TextButton.styleFrom(foregroundColor: Colors.white70),
            child: const Text('Vazgeç'),
          ),
          const SizedBox(width: 4),
          FilledButton.icon(
            onPressed: busy ? null : onDelete,
            style: FilledButton.styleFrom(
              minimumSize: const Size(0, 40),
              backgroundColor: AppColors.danger,
            ),
            icon: busy
                ? const SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.delete_outline_rounded, size: 18),
            label: const Text('Sil'),
          ),
        ],
      ),
    );
  }
}
