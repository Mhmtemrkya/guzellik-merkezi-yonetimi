import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../core/network/api_client.dart';
import '../../core/network/api_config.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import 'gift_card_artwork.dart';

/// HEDİYE KARTINI PAYLAŞ — web'deki `GiftCardShareModal` karşılığı.
///
/// Kart burada çizilir; PDF ve WhatsApp gönderimi AYNI çizimden üretilir, dolayısıyla
/// önizlemede görülen ile gönderilen birebir aynıdır.
Future<void> showGiftCardShareSheet(
  BuildContext context, {
  required ApiClient api,
  required Map<String, dynamic> card,
  required String salonName,
  required String? salonSlug,
  Uint8List? logoBytes,
  String defaultPhone = '',
  bool canWhatsApp = true,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _GiftCardShareSheet(
      api: api,
      card: card,
      salonName: salonName,
      salonSlug: salonSlug,
      logoBytes: logoBytes,
      defaultPhone: defaultPhone,
      canWhatsApp: canWhatsApp,
    ),
  );
}

class _GiftCardShareSheet extends StatefulWidget {
  const _GiftCardShareSheet({
    required this.api,
    required this.card,
    required this.salonName,
    required this.salonSlug,
    required this.logoBytes,
    required this.defaultPhone,
    required this.canWhatsApp,
  });

  final ApiClient api;
  final Map<String, dynamic> card;
  final String salonName;
  final String? salonSlug;
  final Uint8List? logoBytes;
  final String defaultPhone;
  final bool canWhatsApp;

  @override
  State<_GiftCardShareSheet> createState() => _GiftCardShareSheetState();
}

class _GiftCardShareSheetState extends State<_GiftCardShareSheet> {
  GiftCardImages? _images;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  String? _notice;
  bool _sendOpen = false;
  late final TextEditingController _phone = TextEditingController(text: widget.defaultPhone);

  /// Karta bağlı müşteri varsa numara zorunlu değil — sunucu kayıtlı numarayı kullanır.
  bool get _hasLinkedCustomer => '${widget.card['customerId'] ?? ''}'.isNotEmpty;

  /// QR'ın kodladığı adres. Kurum anahtarı ZORUNLU: kodlar yalnız kurum içinde benzersiz.
  String get _qrData {
    final slug = widget.salonSlug ?? '';
    if (slug.isEmpty) return '';
    final base = ApiConfig.publicWebBaseUrl;
    if (base.isEmpty) return '';
    final code = valueOf(widget.card, const ['code'], fallback: '');
    return '$base/hediye-kart/$slug/$code';
  }

  @override
  void initState() {
    super.initState();
    _prepare();
  }

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _prepare() async {
    try {
      final images = await loadGiftCardImages(qrData: _qrData, logoBytes: widget.logoBytes);
      if (mounted) setState(() { _images = images; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = 'Kart çizilemedi: $e'; _loading = false; });
    }
  }

  GiftCardArtworkData get _data =>
      giftCardArtworkData(widget.card, widget.salonName, widget.logoBytes);

  /// Kartı tek sayfalık PDF'e çevirir. SAYFA KARTIN ÖLÇÜSÜNDE: A4'e yerleştirmek
  /// WhatsApp'ta kocaman beyaz boşluklu bir belge gösterirdi.
  Future<Uint8List?> _buildPdf() async {
    final images = _images;
    if (images == null) return null;
    final png = await renderGiftCardPng(_data, images);
    if (png == null) return null;
    final doc = pw.Document();
    const widthMm = 210.0;
    final heightMm = (kCardH / kCardW) * widthMm;
    doc.addPage(
      pw.Page(
        pageFormat: PdfPageFormat(widthMm * PdfPageFormat.mm, heightMm * PdfPageFormat.mm,
            marginAll: 0),
        build: (_) => pw.Image(pw.MemoryImage(png), fit: pw.BoxFit.fill),
      ),
    );
    return doc.save();
  }

  Future<void> _sharePdf() async {
    setState(() { _busy = true; _error = null; });
    try {
      final bytes = await _buildPdf();
      if (bytes == null) throw Exception('PDF üretilemedi.');
      final code = valueOf(widget.card, const ['code'], fallback: 'kart');
      await Printing.sharePdf(bytes: bytes, filename: 'hediye-karti-$code.pdf');
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _printPdf() async {
    setState(() { _busy = true; _error = null; });
    try {
      final bytes = await _buildPdf();
      if (bytes == null) throw Exception('PDF üretilemedi.');
      await Printing.layoutPdf(onLayout: (_) async => bytes);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendWhatsApp() async {
    final phone = _phone.text.trim();
    // Numara BOŞ BIRAKILABİLİR: kart bir müşteriye bağlıysa sunucu kayıtlı numarayı kullanır.
    if (phone.isEmpty && !_hasLinkedCustomer) {
      setState(() => _error = 'Gönderilecek telefon numarasını yazın.');
      return;
    }
    setState(() { _busy = true; _error = null; _notice = null; });
    try {
      final bytes = await _buildPdf();
      if (bytes == null) throw Exception('PDF üretilemedi.');
      await widget.api.post('/api/admin/whatsapp/gift-card', {
        'giftCardId': '${widget.card['id']}',
        'phone': phone.isEmpty ? null : phone,
        'pdfBase64': base64Encode(bytes),
      });
      if (mounted) {
        setState(() { _notice = 'Hediye kartı WhatsApp\'tan gönderildi.'; _sendOpen = false; });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final code = valueOf(widget.card, const ['code'], fallback: '—');
    return DraggableScrollableSheet(
      initialChildSize: .9,
      minChildSize: .5,
      maxChildSize: .95,
      expand: false,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('HEDİYE KARTI',
                            style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 1.4,
                                color: AppColors.primaryDark)),
                        const SizedBox(height: 2),
                        Text(code,
                            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
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
            const Divider(height: 1, color: AppColors.border),
            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                children: [
                  if (_loading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 40),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (_images != null)
                    GiftCardArtwork(data: _data, images: _images!),

                  if (_qrData.isEmpty && !_loading) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.warning.withValues(alpha: .10),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.warning.withValues(alpha: .40)),
                      ),
                      child: const Text(
                        'Kurumun herkese açık adresi tanımlı olmadığı için karta QR basılamadı. '
                        'Salon Profili sayfasından tanımlayınca QR otomatik gelir.',
                        style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: AppColors.warning),
                      ),
                    ),
                  ],

                  if (_error != null) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.danger.withValues(alpha: .08),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.danger.withValues(alpha: .35)),
                      ),
                      child: Text(_error!,
                          style: const TextStyle(
                              fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.danger)),
                    ),
                  ],
                  if (_notice != null) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.success.withValues(alpha: .10),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.success.withValues(alpha: .40)),
                      ),
                      child: Text(_notice!,
                          style: const TextStyle(
                              fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.success)),
                    ),
                  ],

                  // Gönderim kutusu — numara sorulmadan kontör harcanmaz.
                  if (_sendOpen && widget.canWhatsApp) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          TextField(
                            controller: _phone,
                            keyboardType: TextInputType.phone,
                            decoration: InputDecoration(
                              isDense: true,
                              labelText: _hasLinkedCustomer
                                  ? 'Alıcı numarası (boş bırakılabilir)'
                                  : 'Alıcı telefon numarası',
                              hintText: '05xx xxx xx xx',
                            ),
                          ),
                          const SizedBox(height: 10),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              TextButton(
                                onPressed: () => setState(() => _sendOpen = false),
                                child: const Text('Vazgeç'),
                              ),
                              const SizedBox(width: 8),
                              FilledButton.icon(
                                style: FilledButton.styleFrom(backgroundColor: AppColors.success),
                                onPressed: _busy ? null : _sendWhatsApp,
                                icon: _busy
                                    ? const SizedBox(
                                        width: 16, height: 16,
                                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                    : const Icon(Icons.send_rounded, size: 18),
                                label: const Text('Gönder'),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '${_hasLinkedCustomer && _phone.text.trim().isEmpty ? 'Boş bırakırsanız karta bağlı müşterinin kayıtlı numarasına gönderilir. ' : ''}'
                            'Kart PDF olarak gönderilir ve kurumunuzun WhatsApp kontöründen düşer.',
                            style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
                          ),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _busy || _images == null ? null : _printPdf,
                          icon: const Icon(Icons.print_rounded, size: 18),
                          label: const Text('Yazdır', overflow: TextOverflow.ellipsis),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _busy || _images == null ? null : _sharePdf,
                          icon: const Icon(Icons.picture_as_pdf_rounded, size: 18),
                          label: const Text('PDF paylaş', overflow: TextOverflow.ellipsis),
                        ),
                      ),
                    ],
                  ),
                  if (widget.canWhatsApp) ...[
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.success,
                          minimumSize: const Size(0, 48),
                        ),
                        onPressed: _busy || _images == null
                            ? null
                            : () => setState(() { _error = null; _notice = null; _sendOpen = !_sendOpen; }),
                        icon: const Icon(Icons.send_rounded, size: 18),
                        label: const Text("WhatsApp'tan gönder"),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
