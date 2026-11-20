import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Maydi'nin ifadeleri (masaüstü MaydiMascot ile aynı adlar ve görseller).
enum MaydiMood { idle, thinking, speaking, happy, guiding, love }

/// Cevaba göre ifade: masaüstü `maydiResponseMood` ile aynı kural.
MaydiMood maydiResponseMood(Map<String, dynamic>? response, String requestText) {
  final type = '${response?['type'] ?? ''}';
  if (type == 'permission_denied' || type == 'error') return MaydiMood.speaking;
  if (isMaydiAppreciation(requestText)) return MaydiMood.love;
  if (type == 'action_result') return MaydiMood.happy;
  final actions = (response?['actions'] as List?) ?? const [];
  if (type == 'how_to' || actions.any((action) => action is Map && action['type'] == 'navigate')) return MaydiMood.guiding;
  return MaydiMood.speaking;
}

String _fold(String value) => value
    .toLowerCase()
    .replaceAll('ı', 'i')
    .replaceAll('İ', 'i')
    .replaceAll('i̇', 'i')
    .replaceAll('ş', 's')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c');

/// Yalnız teşekkür/iltifat cümlesi (soru içinde geçen teşekkür sayılmaz).
bool isMaydiAppreciation(String message) {
  final words = _fold(message)
      .replaceAll(RegExp(r'[^\p{L}\p{N}\s]', unicode: true), ' ')
      .replaceAll(RegExp(r'\bmaydi\b'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return RegExp(
    r'^(?:cok )?(?:tesekkur(?:ler| ederim| ediyorum| ederiz| ediyoruz)?|sag ?ol(?:un)?|eline saglik|emegine saglik|seni seviyorum|harikasin|supersin|thanks(?: a lot)?|thank you(?: very much)?|thx)(?: cok yardimci oldun)?$',
  ).hasMatch(words);
}

/// Ekran türüne göre maskot boyutları (yükseklik, mantıksal piksel). Telefon ve tablet ayrı
/// ölçeklenir; yatay telefonda da "telefon" sayılır (kısa kenar 600'ün altında).
class MaydiSizes {
  final double header;
  final double hero;
  final double avatar;
  const MaydiSizes._(this.header, this.hero, this.avatar);

  static MaydiSizes of(BuildContext context) {
    final shortest = MediaQuery.sizeOf(context).shortestSide;
    if (shortest >= 900) return const MaydiSizes._(52, 132, 36);
    if (shortest >= 600) return const MaydiSizes._(48, 116, 34);
    if (shortest < 360) return const MaydiSizes._(38, 72, 28);
    return const MaydiSizes._(42, 88, 30);
  }
}

class _Sheet {
  final String asset;
  final int columns;
  final int rows;
  final int frames;
  final Duration duration;
  const _Sheet(this.asset, this.columns, this.rows, this.frames, this.duration);
}

const _base = 'assets/maydi';
const _posters = {
  MaydiMood.idle: '$_base/idle.webp',
  MaydiMood.thinking: '$_base/thinking.webp',
  MaydiMood.speaking: '$_base/speaking.webp',
  MaydiMood.happy: '$_base/happy.webp',
  MaydiMood.guiding: '$_base/guiding.webp',
  MaydiMood.love: '$_base/love.webp',
};
const _loops = {
  MaydiMood.thinking: _Sheet('$_base/thinking-loop.webp', 4, 3, 12, Duration(milliseconds: 2400)),
  MaydiMood.speaking: _Sheet('$_base/speaking-loop.webp', 4, 3, 12, Duration(milliseconds: 1100)),
  MaydiMood.happy: _Sheet('$_base/happy-loop.webp', 4, 3, 12, Duration(milliseconds: 1800)),
  MaydiMood.guiding: _Sheet('$_base/guiding-loop.webp', 4, 3, 12, Duration(milliseconds: 1800)),
  MaydiMood.love: _Sheet('$_base/love-loop.webp', 4, 3, 12, Duration(milliseconds: 2400)),
};
const _wink = _Sheet('$_base/wink.webp', 6, 1, 6, Duration(milliseconds: 540));
const _spin = _Sheet('$_base/spin.webp', 8, 6, 48, Duration(milliseconds: 1650));
const _reactionDuration = {
  MaydiMood.speaking: Duration(milliseconds: 3200),
  MaydiMood.happy: Duration(milliseconds: 2200),
  MaydiMood.guiding: Duration(milliseconds: 4200),
  MaydiMood.love: Duration(milliseconds: 4000),
};

/// Maydi maskotu. Görseller masaüstüyle aynı (Maydi'nin 3B modelinden önceden işlenmiş kareler);
/// çalışma anında 3B çizim yok. Boyut [size] = yükseklik; en/boy oranı 4:5.
///
/// • [mood] belirtilirse o ifade sabit gösterilir (mesaj avatarları için).
/// • [thinking] açıkken düşünme ifadesi döner.
/// • [responseId] değişince [responseMood] ifadesi bir süre oynar, sonra boşta durumuna döner.
/// • Boştayken hafifçe süzülür ve 6,2 sn'de bir göz kırpar; dokununca bir tur döner.
/// • Cihazda "hareketi azalt" açıksa ya da [animated] false ise yalnız sabit resim gösterilir.
class MaydiMascot extends StatefulWidget {
  final double size;
  final MaydiMood mood;
  final bool thinking;
  final bool animated;
  final String? responseId;
  final MaydiMood responseMood;
  final bool spinOnTap;
  final bool spinOnAppear;
  final int spinSignal;

  const MaydiMascot({
    super.key,
    this.size = 64,
    this.mood = MaydiMood.idle,
    this.thinking = false,
    this.animated = true,
    this.responseId,
    this.responseMood = MaydiMood.speaking,
    this.spinOnTap = false,
    this.spinOnAppear = false,
    this.spinSignal = 0,
  });

  @override
  State<MaydiMascot> createState() => _MaydiMascotState();
}

enum _Play { idle, wink, spin, reaction }

class _MaydiMascotState extends State<MaydiMascot> with TickerProviderStateMixin {
  late final AnimationController _frames = AnimationController(vsync: this);
  late final AnimationController _float = AnimationController(vsync: this, duration: const Duration(milliseconds: 4600));
  Timer? _winkTimer;
  Timer? _reactionTimer;
  _Play _play = _Play.idle;
  MaydiMood _reaction = MaydiMood.speaking;
  String? _lastResponse;
  bool _precached = false;
  bool _spinReady = false;
  bool _pendingSpin = false;

  bool get _reduceMotion => MediaQuery.maybeDisableAnimationsOf(context) ?? false;
  bool get _canAnimate => widget.animated && !_reduceMotion;

  @override
  void initState() {
    super.initState();
    _lastResponse = widget.responseId;
    _pendingSpin = widget.spinOnAppear;
    _frames.addStatusListener((status) {
      if (status == AnimationStatus.completed && (_play == _Play.wink || _play == _Play.spin) && mounted) {
        setState(() => _play = _Play.idle);
        _syncAnimation();
      }
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_precached && widget.animated) {
      _precached = true;
      for (final path in [..._posters.values, ..._loops.values.map((sheet) => sheet.asset), _wink.asset]) {
        precacheImage(AssetImage(path), context).catchError((_) {});
      }
      precacheImage(AssetImage(_spin.asset), context).then((_) {
        if (!mounted) return;
        _spinReady = true;
        if (_pendingSpin) _requestSpin();
      }).catchError((_) {});
    }
    _syncAnimation();
  }

  @override
  void didUpdateWidget(MaydiMascot old) {
    super.didUpdateWidget(old);
    final id = widget.responseId;
    if (id != null && id != _lastResponse && !widget.thinking) {
      _startReaction(widget.responseMood);
    }
    if (!widget.thinking) _lastResponse = id;
    if (widget.spinSignal != old.spinSignal) _requestSpin();
    _syncAnimation();
  }

  void _startReaction(MaydiMood mood) {
    _reactionTimer?.cancel();
    setState(() {
      _play = _Play.reaction;
      _reaction = mood;
    });
    _reactionTimer = Timer(_reactionDuration[mood] ?? const Duration(seconds: 3), () {
      if (!mounted) return;
      setState(() => _play = _Play.idle);
      _syncAnimation();
    });
  }

  void _onTap() {
    if (widget.spinOnTap) _requestSpin();
  }

  void _requestSpin() {
    _pendingSpin = false;
    if (!_canAnimate || widget.thinking || widget.mood != MaydiMood.idle) return;
    if (!_spinReady) {
      _pendingSpin = true;
      return;
    }
    setState(() => _play = _Play.spin);
    _frames.stop();
    _syncAnimation();
  }

  /// Şu an hangi kare dizisinin oynayacağını ayarlar; gereksiz zamanlayıcı/kare üretmez.
  void _syncAnimation() {
    if (!mounted) return;
    final sheet = _currentSheet();
    if (!_canAnimate) {
      _frames.stop();
      _float.stop();
      _winkTimer?.cancel();
      return;
    }
    if (!_float.isAnimating) _float.repeat();
    if (sheet == null) {
      _frames.stop();
    } else if (_frames.duration != sheet.duration || !_frames.isAnimating) {
      _frames.duration = sheet.duration;
      if (_play == _Play.wink || _play == _Play.spin) {
        _frames.forward(from: 0);
      } else {
        _frames.repeat();
      }
    }
    final idle = _expression() == MaydiMood.idle && _play == _Play.idle;
    if (idle) {
      _winkTimer ??= Timer.periodic(const Duration(milliseconds: 6200), (_) {
        if (!mounted || _play != _Play.idle || _expression() != MaydiMood.idle) return;
        setState(() => _play = _Play.wink);
        _syncAnimation();
      });
    } else {
      _winkTimer?.cancel();
      _winkTimer = null;
    }
  }

  MaydiMood _expression() {
    if (widget.thinking) return MaydiMood.thinking;
    if (widget.mood != MaydiMood.idle) return widget.mood;
    if (_play == _Play.reaction) return _reaction;
    return MaydiMood.idle;
  }

  _Sheet? _currentSheet() {
    if (!_canAnimate) return null;
    final expression = _expression();
    if (expression == MaydiMood.idle) {
      if (_play == _Play.wink) return _wink;
      if (_play == _Play.spin) return _spin;
      return null;
    }
    return _loops[expression];
  }

  @override
  void dispose() {
    _winkTimer?.cancel();
    _reactionTimer?.cancel();
    _frames.dispose();
    _float.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final height = widget.size;
    final width = height * 0.8;
    final sheet = _currentSheet();
    final poster = _posters[_expression()] ?? _posters[MaydiMood.idle]!;

    Widget art = sheet == null
        ? Image.asset(poster, width: width, height: height, fit: BoxFit.contain, gaplessPlayback: true, filterQuality: FilterQuality.medium)
        : AnimatedBuilder(
            animation: _frames,
            builder: (context, _) {
              final frame = math.min(sheet.frames - 1, (_frames.value * sheet.frames).floor());
              final column = frame % sheet.columns;
              final row = frame ~/ sheet.columns;
              return ClipRect(
                child: SizedBox(
                  width: width,
                  height: height,
                  child: OverflowBox(
                    alignment: Alignment.topLeft,
                    minWidth: width * sheet.columns,
                    maxWidth: width * sheet.columns,
                    minHeight: height * sheet.rows,
                    maxHeight: height * sheet.rows,
                    child: Transform.translate(
                      offset: Offset(-column * width, -row * height),
                      child: Image.asset(
                        sheet.asset,
                        width: width * sheet.columns,
                        height: height * sheet.rows,
                        fit: BoxFit.fill,
                        gaplessPlayback: true,
                        filterQuality: FilterQuality.medium,
                      ),
                    ),
                  ),
                ),
              );
            },
          );

    if (_canAnimate) {
      // Hafif süzülme (masaüstü maydi-float: +1 / -3 piksel, boyuta göre ölçekli).
      final amplitude = height / 48;
      art = AnimatedBuilder(
        animation: _float,
        builder: (context, child) {
          final dy = -1 - 2 * math.sin(_float.value * 2 * math.pi) * amplitude;
          return Transform.translate(offset: Offset(0, dy), child: child);
        },
        child: art,
      );
    }

    // Kare bir dokunma alanı verilse de atlasın görünür karesi 4:5 kalmalı.
    // Aksi hâlde yan karedeki maskotun bir bölümü de çizilir.
    final mascot = ExcludeSemantics(
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: SizedBox(width: width, height: height, child: art),
      ),
    );
    return widget.spinOnTap ? GestureDetector(onTap: _onTap, behavior: HitTestBehavior.opaque, child: mascot) : mascot;
  }
}
