import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../core/theme/app_theme.dart';

/// SAYFA KILAVUZU — web `PageGuide` paritesi (mobil uyarlaması).
///
/// Web'de spotlight ile DOM öğesi karartılıp vurgulanır. Mobilde ekranlar bottom-sheet ve
/// sekme ağırlıklı olduğu için hedef öğe koordinatı güvenilir değil; bu yüzden kılavuz
/// ADIM ADIM KART biçiminde sunulur: ikon + başlık + açıklama, ilerleme noktaları ve
/// "Atla / Bitir" aksiyonları. İçerik web `guideContent.ts` ile aynı dilde tutulur.
///
/// İlk açılışta kendiliğinden görünür; kullanıcı başına ve sayfa başına "görüldü" kaydı
/// tutulur (secure storage). "Bir daha gösterme" tüm kılavuzları kapatır.
class GuideStep {
  const GuideStep({required this.icon, required this.title, required this.desc});
  final IconData icon;
  final String title;
  final String desc;
}

class PageGuideContent {
  const PageGuideContent({
    required this.title,
    required this.intro,
    required this.steps,
  });
  final String title;
  final String intro;
  final List<GuideStep> steps;
}

class GuideStore {
  static const _storage = FlutterSecureStorage();
  static String _seenKey(String uid) => 'guide.seen.$uid';
  static String _skipKey(String uid) => 'guide.skipAll.$uid';

  static Future<Set<String>> seen(String uid) async {
    try {
      final raw = await _storage.read(key: _seenKey(uid));
      if (raw == null || raw.isEmpty) return {};
      final list = jsonDecode(raw);
      return list is List ? list.map((e) => '$e').toSet() : {};
    } catch (_) {
      return {};
    }
  }

  static Future<void> markSeen(String uid, String key) async {
    try {
      final current = await seen(uid);
      if (current.add(key)) {
        await _storage.write(key: _seenKey(uid), value: jsonEncode(current.toList()));
      }
    } catch (_) {
      /* depolama kapalıysa sessizce geç — kılavuz yine çalışır, sadece tekrar açılır */
    }
  }

  static Future<bool> skipAll(String uid) async {
    try {
      return (await _storage.read(key: _skipKey(uid))) == '1';
    } catch (_) {
      return false;
    }
  }

  static Future<void> setSkipAll(String uid) async {
    try {
      await _storage.write(key: _skipKey(uid), value: '1');
    } catch (_) {
      /* yoksay */
    }
  }

  /// Kullanıcı "Kılavuzları tekrar göster" derse tüm izler silinir.
  static Future<void> reset(String uid) async {
    try {
      await _storage.delete(key: _seenKey(uid));
      await _storage.delete(key: _skipKey(uid));
    } catch (_) {
      /* yoksay */
    }
  }
}

/// Kılavuzu alt sayfa olarak açar. [auto] true ise yalnızca daha önce görülmediyse açılır.
Future<void> showPageGuide(
  BuildContext context, {
  required String pageKey,
  required String uid,
  required PageGuideContent content,
  bool auto = false,
}) async {
  if (auto) {
    if (await GuideStore.skipAll(uid)) return;
    if ((await GuideStore.seen(uid)).contains(pageKey)) return;
  }
  if (!context.mounted) return;

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _GuideSheet(content: content, uid: uid, pageKey: pageKey),
  );
  await GuideStore.markSeen(uid, pageKey);
}

class _GuideSheet extends StatefulWidget {
  const _GuideSheet({required this.content, required this.uid, required this.pageKey});
  final PageGuideContent content;
  final String uid;
  final String pageKey;

  @override
  State<_GuideSheet> createState() => _GuideSheetState();
}

class _GuideSheetState extends State<_GuideSheet> {
  int _index = 0;

  /// Kartlar PARMAKLA KAYDIRILARAK da geçilir. Önceden yalnız "İleri/Geri" butonları
  /// vardı; kullanıcılar karta dokunup sağa-sola sürüklediğinde hiçbir şey olmuyor,
  /// kılavuz takılmış gibi görünüyordu. PageView doğal kaydırmayı getirir, butonlar
  /// da aynı denetleyiciyi sürdüğü için iki yol tek durumda buluşur.
  late final PageController _pager = PageController();

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  void _goTo(int i) {
    final steps = widget.content.steps;
    if (i < 0 || i >= steps.length) return;
    _pager.animateToPage(
      i,
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  Widget build(BuildContext context) {
    final steps = widget.content.steps;
    final isLast = _index == steps.length - 1;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
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
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          const SizedBox(height: 14),

          Row(
            children: [
              const Icon(Icons.menu_book_rounded, size: 18, color: AppColors.primaryDark),
              const SizedBox(width: 8),
              Expanded(
                child: Text(widget.content.title,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded, size: 20),
              ),
            ],
          ),
          if (_index == 0) ...[
            const SizedBox(height: 2),
            Text(widget.content.intro,
                style: const TextStyle(fontSize: 12, color: AppColors.muted, height: 1.35)),
          ],
          const SizedBox(height: 16),

          // Adım kartları — PARMAKLA KAYDIRILABİLİR.
          // Yükseklik sabit: kartlar arası zıplama olmasın, en uzun açıklama da sığsın.
          SizedBox(
            height: 168,
            child: PageView.builder(
              controller: _pager,
              itemCount: steps.length,
              onPageChanged: (i) => setState(() => _index = i),
              itemBuilder: (context, i) {
                final step = steps[i];
                return Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: .05),
                    borderRadius: BorderRadius.circular(16),
                    border:
                        Border.all(color: AppColors.primary.withValues(alpha: .18)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: .13),
                              borderRadius: BorderRadius.circular(11),
                            ),
                            child: Icon(step.icon,
                                size: 19, color: AppColors.primaryDark),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(step.title,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800, fontSize: 13.5)),
                          ),
                          Text('${i + 1}/${steps.length}',
                              style: const TextStyle(
                                  fontSize: 11, color: AppColors.muted)),
                        ],
                      ),
                      const SizedBox(height: 10),
                      // Uzun açıklamalarda kart taşmasın diye kendi içinde kaydırılır.
                      Expanded(
                        child: SingleChildScrollView(
                          child: Text(step.desc,
                              style:
                                  const TextStyle(fontSize: 12.5, height: 1.45)),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 10),

          // İlerleme noktaları — dokunarak da o adıma gidilir.
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < steps.length; i++)
                GestureDetector(
                  onTap: () => _goTo(i),
                  behavior: HitTestBehavior.opaque,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2.5, vertical: 6),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      width: i == _index ? 18 : 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: i == _index ? AppColors.primary : AppColors.border,
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),

          Row(
            children: [
              TextButton(
                onPressed: () async {
                  await GuideStore.setSkipAll(widget.uid);
                  if (context.mounted) Navigator.pop(context);
                },
                child: const Text('Bir daha gösterme',
                    style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
              ),
              const Spacer(),
              if (_index > 0)
                TextButton(
                  onPressed: () => _goTo(_index - 1),
                  child: const Text('Geri'),
                ),
              const SizedBox(width: 6),
              FilledButton(
                // Satır içi düğme: tema varsayılanı sonsuz genişlik ister, soldaki
                // adım metnini 0 piksele düşürüp harfleri alt alta dizerdi.
                style: AppButtons.inline(height: 40),
                onPressed: () {
                  if (isLast) {
                    Navigator.pop(context);
                  } else {
                    _goTo(_index + 1);
                  }
                },
                child: Text(isLast ? 'Bitir' : 'İleri'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
