import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/photo_utils.dart';

/// SALON VİTRİNİ — GİRİŞSİZ (App Store 5.1.1(v)).
///
/// Salonları, hizmet/fiyat listesini, ekibi ve yorumları görmek hesap gerektirmez; bu yüzden
/// oturum açmamış kullanıcıya da açıktır (router'daki anonim liste). Hesap yalnız randevu
/// almak/yönetmek için istenir. Veri web /salonlar ile aynı anonim uçtan gelir
/// (/api/public/salons); istekler [ApiClient.getPublic] ile token'sız gider.

const double _maxContentWidth = 760;

Widget _constrained(Widget child) => Center(
      heightFactor: 1,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: _maxContentWidth),
        child: child,
      ),
    );

/// Randevu hesabı gerektirir: müşteri girişine (kayıt bağlantısı da oradadır) götürür.
void _goToCustomerLogin(BuildContext context) => context.go('/login?mode=customer');

// ============================ Salon listesi ============================

class ExploreSalonsScreen extends StatefulWidget {
  const ExploreSalonsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<ExploreSalonsScreen> createState() => _ExploreSalonsScreenState();
}

class _ExploreSalonsScreenState extends State<ExploreSalonsScreen> {
  static const _pageSize = 20;

  final _search = TextEditingController();
  Timer? _debounce;
  List<String> _categories = const [];
  String? _category;

  final List<Map<String, dynamic>> _items = [];
  int _total = 0;
  int _page = 0;
  bool _loading = false;
  String? _error;
  // Arama/filtre değişince eski sayfanın geç gelen yanıtı yeni listeye karışmasın.
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _loadFacets();
    _reload();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _loadFacets() async {
    try {
      final data = await widget.api.getPublic('/api/public/salons/facets') as Map;
      if (!mounted) return;
      setState(() => _categories = ((data['categories'] as List?) ?? const []).map((e) => '$e').toList());
    } catch (_) {
      // Filtre çipleri isteğe bağlıdır; liste yine de gösterilir.
    }
  }

  Future<void> _reload() async {
    _generation++;
    setState(() {
      _items.clear();
      _total = 0;
      _page = 0;
      _error = null;
    });
    await _loadMore();
  }

  Future<void> _loadMore() async {
    if (_loading) return;
    final gen = _generation;
    setState(() => _loading = true);
    try {
      final q = _search.text.trim();
      final data = await widget.api.getPublic('/api/public/salons/', query: {
        if (q.isNotEmpty) 'q': q,
        if (_category != null) 'category': _category,
        'page': _page + 1,
        'pageSize': _pageSize,
      }) as Map;
      if (!mounted || gen != _generation) return;
      setState(() {
        _items.addAll(((data['items'] as List?) ?? const []).map((e) => (e as Map).cast<String, dynamic>()));
        _total = (data['total'] as num?)?.toInt() ?? _items.length;
        _page++;
      });
    } catch (e) {
      if (!mounted || gen != _generation) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted && gen == _generation) setState(() => _loading = false);
    }
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _reload);
  }

  void _selectCategory(String? c) {
    if (c == _category) return;
    _category = c;
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final hasMore = _items.length < _total;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Salonları Keşfet'),
        leading: IconButton(
          tooltip: 'Girişe dön',
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => context.canPop() ? context.pop() : context.go('/login'),
        ),
        actions: [
          TextButton(
            onPressed: () => _goToCustomerLogin(context),
            child: const Text('Giriş Yap'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: NotificationListener<ScrollNotification>(
          onNotification: (n) {
            if (hasMore && !_loading && _error == null && n.metrics.extentAfter < 400) _loadMore();
            return false;
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            children: [
              _constrained(Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _GuestNotice(),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _search,
                    onChanged: _onSearchChanged,
                    textInputAction: TextInputAction.search,
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search_rounded),
                      hintText: 'Salon adı ara',
                    ),
                  ),
                  if (_categories.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 40,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: const Text('Tümü'),
                              selected: _category == null,
                              onSelected: (_) => _selectCategory(null),
                            ),
                          ),
                          for (final c in _categories)
                            Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: ChoiceChip(
                                label: Text(c),
                                selected: _category == c,
                                onSelected: (_) => _selectCategory(c),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 14),
                  for (final s in _items)
                    _SalonCard(
                      salon: s,
                      onTap: () => context.push('/explore/salon/${Uri.encodeComponent('${s['slug']}')}'),
                    ),
                  if (_error != null)
                    _InlineError(message: _error!, onRetry: _items.isEmpty ? _reload : _loadMore)
                  else if (_loading)
                    const Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (_items.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 48),
                      child: Text(
                        'Aramanıza uygun salon bulunamadı.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppColors.muted),
                      ),
                    ),
                ],
              )),
            ],
          ),
        ),
      ),
    );
  }
}

class _GuestNotice extends StatelessWidget {
  const _GuestNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.rose.withValues(alpha: .22),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline_rounded, color: AppColors.primaryDark, size: 20),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Salonları, hizmetleri, fiyatları, ekibi ve yorumları giriş yapmadan inceleyebilirsiniz. '
              'Hesap yalnızca randevu almak ve randevularınızı yönetmek için gerekir.',
              style: TextStyle(fontSize: 13, color: AppColors.ink, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

class _SalonCard extends StatelessWidget {
  const _SalonCard({required this.salon, required this.onTap});
  final Map<String, dynamic> salon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final image = imageProviderOf(salon['coverImage']) ?? imageProviderOf(salon['logo']);
    final cats = ((salon['categories'] as List?) ?? const []).map((e) => '$e').toList();
    final city = salon['city']?.toString();
    final reviewCount = (salon['reviewCount'] as num?)?.toInt() ?? 0;
    final avg = (salon['salonAvg'] as num?) ?? (salon['staffAvg'] as num?);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: SizedBox.square(
                  dimension: 84,
                  child: image == null
                      ? Container(
                          color: AppColors.rose.withValues(alpha: .35),
                          child: const Icon(Icons.storefront_rounded, color: AppColors.primaryDark, size: 34),
                        )
                      : Image(image: image, fit: BoxFit.cover),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(
                        child: Text(
                          salon['name']?.toString() ?? 'Salon',
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                        ),
                      ),
                      if (salon['isFeatured'] == true)
                        const Icon(Icons.workspace_premium_rounded, size: 18, color: AppColors.warning),
                    ]),
                    const SizedBox(height: 4),
                    if (city != null && city.isNotEmpty)
                      Row(children: [
                        const Icon(Icons.location_on_outlined, size: 14, color: AppColors.muted),
                        const SizedBox(width: 3),
                        Text(city, style: const TextStyle(color: AppColors.muted, fontSize: 12)),
                      ]),
                    const SizedBox(height: 4),
                    _RatingLine(avg: avg, count: reviewCount),
                    if (cats.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [for (final c in cats.take(4)) _Tag(c)],
                      ),
                    ],
                  ],
                ),
              ),
              const Padding(
                padding: EdgeInsets.only(left: 4, top: 4),
                child: Icon(Icons.arrow_forward_ios_rounded, size: 14, color: AppColors.primary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ============================ Salon detayı ============================

class ExploreSalonDetailScreen extends StatefulWidget {
  const ExploreSalonDetailScreen({required this.api, required this.slug, super.key});
  final ApiClient api;
  final String slug;

  @override
  State<ExploreSalonDetailScreen> createState() => _ExploreSalonDetailScreenState();
}

class _ExploreSalonDetailScreenState extends State<ExploreSalonDetailScreen> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() {
    final slug = Uri.encodeComponent(widget.slug);
    return Future.wait([
      widget.api.getPublic('/api/public/salons/$slug'),
      // Yorumlar ikincildir: gelmezse salon sayfası yine açılır.
      widget.api
          .getPublic('/api/public/salons/$slug/reviews', query: {'page': 1, 'pageSize': 10})
          .catchError((_) => null),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Salon')),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: _constrained(Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () => _goToCustomerLogin(context),
                icon: const Icon(Icons.event_available_rounded),
                label: const Text('Randevu Al'),
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Randevu almak için müşteri hesabıyla giriş yapmanız gerekir.',
              style: TextStyle(fontSize: 11, color: AppColors.muted),
            ),
          ],
        )),
      ),
      body: FutureBuilder<List<dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return _InlineError(
              message: '${snap.error}',
              onRetry: () => setState(() => _future = _load()),
            );
          }
          final salon = (snap.data![0] as Map).cast<String, dynamic>();
          final reviews = snap.data![1] is Map ? (snap.data![1] as Map).cast<String, dynamic>() : null;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [_constrained(_SalonDetailBody(salon: salon, reviews: reviews))],
          );
        },
      ),
    );
  }
}

class _SalonDetailBody extends StatelessWidget {
  const _SalonDetailBody({required this.salon, required this.reviews});
  final Map<String, dynamic> salon;
  final Map<String, dynamic>? reviews;

  @override
  Widget build(BuildContext context) {
    final logo = imageProviderOf(salon['logo']);
    final photos = [
      ...((salon['sliderPhotos'] as List?) ?? const []),
      ...((salon['servicePhotos'] as List?) ?? const []),
    ].map(imageProviderOf).whereType<ImageProvider>().toList();
    final aggregates = (salon['aggregates'] as Map?)?.cast<String, dynamic>() ?? const {};
    final services = ((salon['services'] as List?) ?? const []).cast<Map>();
    final staff = ((salon['staff'] as List?) ?? const []).cast<Map>();
    final branches = ((salon['branches'] as List?) ?? const []).cast<Map>();
    final reviewItems = ((reviews?['items'] as List?) ?? const []).cast<Map>();

    String? text(String key) {
      final v = salon[key]?.toString().trim();
      return (v == null || v.isEmpty) ? null : v;
    }

    final description = text('description');
    final contact = <(IconData, String)>[
      if (text('address') != null) (Icons.location_on_outlined, text('address')!),
      if (text('city') != null) (Icons.location_city_outlined, text('city')!),
      if (text('workingHoursText') != null) (Icons.schedule_rounded, text('workingHoursText')!),
      if (text('publicPhone') != null) (Icons.phone_outlined, text('publicPhone')!),
      if (text('publicEmail') != null) (Icons.mail_outline_rounded, text('publicEmail')!),
      if (text('instagram') != null) (Icons.camera_alt_outlined, text('instagram')!),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          CircleAvatar(
            radius: 32,
            backgroundColor: AppColors.rose.withValues(alpha: .4),
            backgroundImage: logo,
            child: logo == null ? const Icon(Icons.storefront_rounded, color: AppColors.primaryDark) : null,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  salon['name']?.toString() ?? 'Salon',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 4),
                _RatingLine(
                  avg: (aggregates['salonAvg'] as num?) ?? (aggregates['staffAvg'] as num?),
                  count: (aggregates['reviewCount'] as num?)?.toInt() ?? 0,
                ),
              ],
            ),
          ),
        ]),
        if (photos.isNotEmpty) ...[
          const SizedBox(height: 16),
          SizedBox(
            height: 150,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: photos.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (_, i) => ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Image(image: photos[i], width: 210, height: 150, fit: BoxFit.cover),
              ),
            ),
          ),
        ],
        if (description != null) ...[
          const SizedBox(height: 16),
          Text(description, style: const TextStyle(height: 1.4)),
        ],
        if (contact.isNotEmpty) ...[
          const _SectionTitle('Bilgiler'),
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(children: [
                for (final (icon, value) in contact)
                  ListTile(
                    dense: true,
                    leading: Icon(icon, color: AppColors.primary, size: 20),
                    title: Text(value),
                  ),
              ]),
            ),
          ),
        ],
        if (branches.length > 1) ...[
          const _SectionTitle('Şubeler'),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final b in branches)
                _Tag([b['name'], b['city']].where((e) => e != null && '$e'.isNotEmpty).join(' · ')),
            ],
          ),
        ],
        const _SectionTitle('Hizmetler ve Fiyatlar'),
        if (services.isEmpty)
          const Text('Bu salon henüz hizmet listesi yayınlamadı.', style: TextStyle(color: AppColors.muted))
        else
          for (final (i, g) in services.indexed)
            Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: Theme(
                data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                child: ExpansionTile(
                  initiallyExpanded: i == 0 || services.length <= 3,
                  title: Text('${g['category'] ?? 'Diğer'}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  children: [
                    for (final s in ((g['items'] as List?) ?? const []).cast<Map>())
                      ListTile(
                        dense: true,
                        title: Text('${s['name'] ?? ''}'),
                        subtitle: Text('${(s['durationMinutes'] as num?)?.toInt() ?? 0} dk'),
                        trailing: Text(
                          _price(s['price']),
                          style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.primaryDark),
                        ),
                      ),
                  ],
                ),
              ),
            ),
        if (staff.isNotEmpty) ...[
          const _SectionTitle('Ekip'),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final p in staff)
                SizedBox(
                  width: 160,
                  child: Card(
                    margin: EdgeInsets.zero,
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: Row(children: [
                        CircleAvatar(
                          radius: 18,
                          backgroundColor: AppColors.rose.withValues(alpha: .4),
                          backgroundImage: imageProviderOf(p['photoUrl']),
                          child: imageProviderOf(p['photoUrl']) == null
                              ? const Icon(Icons.person_rounded, size: 18, color: AppColors.primaryDark)
                              : null,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${p['fullName'] ?? ''}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                              Text('${p['title'] ?? ''}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(color: AppColors.muted, fontSize: 11)),
                            ],
                          ),
                        ),
                      ]),
                    ),
                  ),
                ),
            ],
          ),
        ],
        const _SectionTitle('Yorumlar'),
        if (reviewItems.isEmpty)
          const Text('Henüz yorum yok.', style: TextStyle(color: AppColors.muted))
        else
          for (final r in reviewItems) _ReviewCard(review: r.cast<String, dynamic>()),
      ],
    );
  }
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.review});
  final Map<String, dynamic> review;

  @override
  Widget build(BuildContext context) {
    final stars = (review['salonStars'] as num?) ?? (review['staffStars'] as num?) ?? 0;
    final comment = review['comment']?.toString().trim();
    final meta = [review['staffName'], review['serviceName']]
        .where((e) => e != null && '$e'.isNotEmpty)
        .join(' · ');
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Text('${review['maskedName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
              _Stars(stars.toDouble()),
            ]),
            if (meta.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(meta, style: const TextStyle(color: AppColors.muted, fontSize: 12)),
            ],
            if (comment != null && comment.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(comment),
            ],
          ],
        ),
      ),
    );
  }
}

// ============================ Yardımcılar ============================

String _price(dynamic v) {
  final n = (v as num?) ?? 0;
  final s = n == n.roundToDouble() ? n.toInt().toString() : n.toStringAsFixed(2).replaceAll('.', ',');
  // Binlik ayırıcı: 1500 → 1.500
  final parts = s.split(',');
  final whole = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => '.');
  return '${parts.length > 1 ? '$whole,${parts[1]}' : whole} ₺';
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 22, bottom: 10),
        child: Text(text, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
      );
}

class _Tag extends StatelessWidget {
  const _Tag(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: AppColors.rose.withValues(alpha: .25),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(text, style: const TextStyle(fontSize: 11, color: AppColors.primaryDark, fontWeight: FontWeight.w600)),
      );
}

class _RatingLine extends StatelessWidget {
  const _RatingLine({required this.avg, required this.count});
  final num? avg;
  final int count;

  @override
  Widget build(BuildContext context) {
    if (count == 0 || avg == null) {
      return const Text('Henüz değerlendirme yok', style: TextStyle(color: AppColors.muted, fontSize: 12));
    }
    return Row(children: [
      _Stars(avg!.toDouble()),
      const SizedBox(width: 6),
      Text('${avg!.toStringAsFixed(1)} ($count yorum)', style: const TextStyle(color: AppColors.muted, fontSize: 12)),
    ]);
  }
}

class _Stars extends StatelessWidget {
  const _Stars(this.value);
  final double value;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 1; i <= 5; i++)
            Icon(
              Icons.star_rounded,
              size: 15,
              color: i <= value.round() ? const Color(0xFFF4A821) : AppColors.border,
            ),
        ],
      );
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded, size: 40, color: AppColors.danger),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.muted)),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: onRetry, child: const Text('Tekrar dene')),
          ],
        ),
      );
}
