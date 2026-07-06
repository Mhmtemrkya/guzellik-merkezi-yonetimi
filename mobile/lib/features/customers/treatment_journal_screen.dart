import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../../core/theme/responsive.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import 'customer_picker.dart';

/// Tedavi Günlüğü (Önce/Sonra) — web TreatmentJournal paritesi.
/// Müşteri başına önce/sonra/süreç fotoğrafları: ekle (kamera/galeri), karşılaştır, sil.
class TreatmentJournalScreen extends StatefulWidget {
  const TreatmentJournalScreen({
    required this.api,
    this.customerId,
    this.customerName,
    super.key,
  });

  final ApiClient api;
  final String? customerId;
  final String? customerName;

  @override
  State<TreatmentJournalScreen> createState() => _TreatmentJournalScreenState();
}

const _kinds = <(String, String)>[
  ('Before', 'Önce'),
  ('After', 'Sonra'),
  ('Progress', 'Süreç'),
];

String _kindLabel(String k) =>
    _kinds.firstWhere((e) => e.$1 == k, orElse: () => (k, k)).$2;

class _TreatmentJournalScreenState extends State<TreatmentJournalScreen> {
  String? _cid;
  String? _cname;
  Future<List<Map<String, dynamic>>>? _future;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _cid = widget.customerId;
    _cname = widget.customerName;
    if (_cid != null) {
      _future = _load();
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) => _ensureCustomer());
    }
  }

  Future<void> _ensureCustomer() async {
    final picked = await pickCustomer(context, widget.api);
    if (!mounted) return;
    if (picked == null) {
      if (Navigator.canPop(context)) Navigator.pop(context);
      return;
    }
    setState(() {
      _cid = picked.id;
      _cname = picked.name;
      _future = _load();
    });
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final res =
        await widget.api.get('/api/admin/customers/$_cid/treatment-photos');
    final list = res is List
        ? res.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
        : <Map<String, dynamic>>[];
    list.sort((a, b) {
      final da = parseUtcToLocal(a['takenAtUtc']);
      final db = parseUtcToLocal(b['takenAtUtc']);
      return (db ?? DateTime(0)).compareTo(da ?? DateTime(0));
    });
    return list;
  }

  void _reload() => setState(() {
        _future = _load();
      });

  Future<void> _addPhoto() async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _AddPhotoSheet(api: widget.api, customerId: _cid!),
    );
    if (result == true) _reload();
  }

  Future<void> _delete(Map<String, dynamic> photo) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Fotoğrafı sil'),
        content: const Text('Bu fotoğraf günlükten kalıcı olarak silinsin mi?'),
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
    setState(() => _busy = true);
    try {
      await widget.api.delete(
          '/api/admin/customers/$_cid/treatment-photos/${photo['id']}');
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: _cid == null
            ? null
            : FloatingActionButton.extended(
                onPressed: _busy ? null : _addPhoto,
                backgroundColor: AppColors.primary,
                icon: const Icon(Icons.add_a_photo_rounded),
                label: const Text('Fotoğraf Ekle'),
              ),
        body: SafeArea(
          child: _cid == null
              ? _pickPrompt()
              : RefreshIndicator(
                  color: AppColors.primary,
                  onRefresh: () async => _reload(),
                  child: FutureBuilder<List<Map<String, dynamic>>>(
                    future: _future,
                    builder: (context, snap) {
                      final photos = snap.data ?? const [];
                      final befores =
                          photos.where((p) => '${p['kind']}' == 'Before').toList();
                      final afters =
                          photos.where((p) => '${p['kind']}' == 'After').toList();
                      return ListView(
                        padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                        children: [
                          PageHeader(
                            eyebrow: _cname ?? 'Müşteri',
                            title: 'Tedavi Günlüğü',
                            subtitle: 'Önce/sonra ve süreç fotoğrafları.',
                            action: IconButton(
                              tooltip: 'Müşteri değiştir',
                              onPressed: _ensureCustomer,
                              color: AppColors.primaryDark,
                              icon: const Icon(Icons.swap_horiz_rounded),
                            ),
                          ),
                          const SizedBox(height: 14),
                          if (snap.connectionState != ConnectionState.done &&
                              !snap.hasData)
                            const Padding(
                              padding: EdgeInsets.all(40),
                              child: Center(child: CircularProgressIndicator()),
                            )
                          else if (photos.isEmpty)
                            _emptyBox()
                          else ...[
                            if (befores.isNotEmpty && afters.isNotEmpty) ...[
                              _compareCard(befores.last, afters.first),
                              const SizedBox(height: 16),
                            ],
                            ..._kinds.map((k) {
                              final group = photos
                                  .where((p) => '${p['kind']}' == k.$1)
                                  .toList();
                              if (group.isEmpty) return const SizedBox.shrink();
                              return _kindSection(k.$2, group);
                            }),
                          ],
                        ],
                      );
                    },
                  ),
                ),
        ),
      ),
    );
  }

  Widget _pickPrompt() => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.photo_library_outlined,
                size: 44, color: AppColors.primary),
            const SizedBox(height: 12),
            const Text('Tedavi günlüğü için müşteri seçin',
                style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _ensureCustomer,
              icon: const Icon(Icons.person_add_alt_1_rounded),
              label: const Text('Müşteri Seç'),
            ),
          ],
        ),
      );

  Widget _emptyBox() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 48),
        child: Center(
          child: Column(
            children: [
              Icon(Icons.add_a_photo_outlined,
                  size: 44, color: AppColors.primary.withValues(alpha: .5)),
              const SizedBox(height: 12),
              const Text('Henüz fotoğraf yok.',
                  style: TextStyle(color: AppColors.muted, fontSize: 13)),
              const SizedBox(height: 4),
              const Text('Önce/sonra için "Fotoğraf Ekle"ye dokunun.',
                  style: TextStyle(color: AppColors.muted, fontSize: 12)),
            ],
          ),
        ),
      );

  Widget _compareCard(Map<String, dynamic> before, Map<String, dynamic> after) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Önce → Sonra',
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primaryDark)),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: _comparePane('Önce', before, AppColors.primary)),
              const SizedBox(width: 8),
              Expanded(child: _comparePane('Sonra', after, AppColors.success)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _comparePane(String label, Map<String, dynamic> photo, Color color) {
    final d = parseUtcToLocal(photo['takenAtUtc']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: AspectRatio(
            aspectRatio: 1,
            child: GestureDetector(
              onTap: () => _viewFull(photo),
              child: _photoImage(photo, fit: BoxFit.cover),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Row(
          children: [
            Container(width: 7, height: 7, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
            const SizedBox(width: 5),
            Text(label,
                style: TextStyle(
                    fontSize: 11, fontWeight: FontWeight.w700, color: color)),
            const Spacer(),
            if (d != null)
              Text(DateFormat('d MMM', 'tr_TR').format(d),
                  style:
                      const TextStyle(fontSize: 10, color: AppColors.muted)),
          ],
        ),
      ],
    );
  }

  Widget _kindSection(String title, List<Map<String, dynamic>> group) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(title,
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(width: 6),
              Text('${group.length}',
                  style: const TextStyle(color: AppColors.muted, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 8),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: group.length,
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: gridCols(context, 3),
              crossAxisSpacing: 8,
              mainAxisSpacing: 8,
            ),
            itemBuilder: (_, i) {
              final p = group[i];
              return GestureDetector(
                onTap: () => _viewFull(p),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: _photoImage(p, fit: BoxFit.cover),
                    ),
                    Positioned(
                      top: 4,
                      right: 4,
                      child: GestureDetector(
                        onTap: () => _delete(p),
                        child: Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: .45),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.delete_outline_rounded,
                              size: 15, color: Colors.white),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  void _viewFull(Map<String, dynamic> photo) {
    final note = '${photo['note'] ?? ''}';
    final svc = '${photo['serviceName'] ?? ''}';
    final d = parseUtcToLocal(photo['takenAtUtc']);
    showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: InteractiveViewer(
                child: _photoImage(photo, fit: BoxFit.contain),
              ),
            ),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              color: Colors.black,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _chip(_kindLabel('${photo['kind']}')),
                      const Spacer(),
                      if (d != null)
                        Text(DateFormat('d MMM yyyy', 'tr_TR').format(d),
                            style: const TextStyle(
                                color: Colors.white70, fontSize: 12)),
                    ],
                  ),
                  if (svc.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(svc,
                          style: const TextStyle(
                              color: Colors.white, fontSize: 12.5)),
                    ),
                  if (note.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(note,
                          style: const TextStyle(
                              color: Colors.white70, fontSize: 12.5)),
                    ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Kapat',
                          style: TextStyle(color: Colors.white)),
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

  Widget _chip(String label) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        decoration: BoxDecoration(
          color: AppColors.primary,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(label,
            style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w700)),
      );

  Widget _photoImage(Map<String, dynamic> photo, {required BoxFit fit}) {
    final provider = _imageProviderOf('${photo['imageUrl'] ?? ''}');
    if (provider == null) {
      return Container(
        color: AppColors.surfaceSoft,
        child: const Icon(Icons.broken_image_outlined, color: AppColors.muted),
      );
    }
    return Image(image: provider, fit: fit,
        errorBuilder: (_, _, _) => Container(
              color: AppColors.surfaceSoft,
              child: const Icon(Icons.broken_image_outlined,
                  color: AppColors.muted),
            ));
  }
}

/// data:...;base64,... veya http(s) URL → ImageProvider.
ImageProvider? _imageProviderOf(String url) {
  if (url.isEmpty) return null;
  if (url.startsWith('data:')) {
    final comma = url.indexOf(',');
    if (comma < 0) return null;
    try {
      final Uint8List bytes = base64Decode(url.substring(comma + 1));
      return MemoryImage(bytes);
    } catch (_) {
      return null;
    }
  }
  return NetworkImage(url);
}

// --------------------------- Fotoğraf ekleme sayfası ---------------------------

class _AddPhotoSheet extends StatefulWidget {
  const _AddPhotoSheet({required this.api, required this.customerId});
  final ApiClient api;
  final String customerId;

  @override
  State<_AddPhotoSheet> createState() => _AddPhotoSheetState();
}

class _AddPhotoSheetState extends State<_AddPhotoSheet> {
  String _kind = 'Before';
  String? _dataUrl;
  DateTime _takenAt = DateTime.now();
  final _note = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final x = await picker.pickImage(
        source: source,
        maxWidth: 1080,
        maxHeight: 1080,
        imageQuality: 82,
      );
      if (x == null) return;
      final bytes = await x.readAsBytes();
      setState(() => _dataUrl = 'data:image/jpeg;base64,${base64Encode(bytes)}');
    } catch (e) {
      setState(() => _error = 'Fotoğraf alınamadı: $e');
    }
  }

  Future<void> _save() async {
    if (_dataUrl == null) {
      setState(() => _error = 'Önce bir fotoğraf seçin.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.post(
        '/api/admin/customers/${widget.customerId}/treatment-photos',
        {
          'kind': _kind,
          'imageUrl': _dataUrl,
          'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
          'serviceDefinitionId': null,
          'takenAtUtc': DateTime(_takenAt.year, _takenAt.month, _takenAt.day, 12)
              .toUtc()
              .toIso8601String(),
        },
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
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
              const Text('Fotoğraf ekle',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 14),
              // Tür seçimi
              SegmentedButton<String>(
                segments: _kinds
                    .map((k) => ButtonSegment(value: k.$1, label: Text(k.$2)))
                    .toList(),
                selected: {_kind},
                onSelectionChanged: (s) => setState(() => _kind = s.first),
              ),
              const SizedBox(height: 14),
              // Önizleme / seçici
              AspectRatio(
                aspectRatio: 16 / 10,
                child: _dataUrl == null
                    ? Container(
                        decoration: BoxDecoration(
                          color: AppColors.surfaceSoft,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: const Center(
                          child: Icon(Icons.image_outlined,
                              size: 40, color: AppColors.muted),
                        ),
                      )
                    : ClipRRect(
                        borderRadius: BorderRadius.circular(14),
                        child: Image(
                          image: _imageProviderOf(_dataUrl!)!,
                          fit: BoxFit.cover,
                          width: double.infinity,
                        ),
                      ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : () => _pick(ImageSource.camera),
                      icon: const Icon(Icons.photo_camera_rounded, size: 18),
                      label: const Text('Kamera'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : () => _pick(ImageSource.gallery),
                      icon: const Icon(Icons.photo_library_rounded, size: 18),
                      label: const Text('Galeri'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _note,
                maxLines: 2,
                decoration: InputDecoration(
                  labelText: 'Not (opsiyonel)',
                  isDense: true,
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 10),
              InkWell(
                onTap: () async {
                  final now = DateTime.now();
                  final picked = await showDatePicker(
                    context: context,
                    firstDate: DateTime(now.year - 5),
                    lastDate: now,
                    initialDate: _takenAt,
                  );
                  if (picked != null) setState(() => _takenAt = picked);
                },
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Çekim tarihi',
                    isDense: true,
                    prefixIcon: Icon(Icons.event_rounded),
                  ),
                  child: Text(DateFormat('d MMMM yyyy', 'tr_TR').format(_takenAt)),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!,
                    style:
                        const TextStyle(color: AppColors.danger, fontSize: 12.5)),
              ],
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _busy ? null : _save,
                icon: _busy
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.check_rounded),
                label: const Text('Günlüğe ekle'),
                style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(48)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
