import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

/// data:...;base64,... veya http(s) URL → ImageProvider (yoksa null).
ImageProvider? imageProviderOf(dynamic url) {
  final s = url?.toString() ?? '';
  if (s.isEmpty || s == 'null') return null;
  if (s.startsWith('data:')) {
    final comma = s.indexOf(',');
    if (comma < 0) return null;
    try {
      final Uint8List bytes = base64Decode(s.substring(comma + 1));
      return MemoryImage(bytes);
    } catch (_) {
      return null;
    }
  }
  if (s.startsWith('http')) return NetworkImage(s);
  return null;
}

/// Kamera / galeri seçtirip küçültülmüş JPEG'i data-URL olarak döndürür.
/// - null → vazgeçildi (değişiklik yok)
/// - ''   → "Fotoğrafı kaldır" seçildi
/// - 'data:image/jpeg;base64,...' → yeni fotoğraf
Future<String?> pickPhotoDataUrl(BuildContext context,
    {bool allowRemove = false}) async {
  final choice = await showModalBottomSheet<String>(
    context: context,
    useSafeArea: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 8),
          ListTile(
            leading: const Icon(Icons.photo_camera_rounded),
            title: const Text('Kamera ile çek'),
            onTap: () => Navigator.pop(ctx, 'camera'),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library_rounded),
            title: const Text('Galeriden seç'),
            onTap: () => Navigator.pop(ctx, 'gallery'),
          ),
          if (allowRemove)
            ListTile(
              leading: const Icon(Icons.delete_outline_rounded,
                  color: Colors.redAccent),
              title: const Text('Fotoğrafı kaldır',
                  style: TextStyle(color: Colors.redAccent)),
              onTap: () => Navigator.pop(ctx, 'remove'),
            ),
          const SizedBox(height: 4),
        ],
      ),
    ),
  );
  if (choice == null) return null;
  if (choice == 'remove') return '';

  final picker = ImagePicker();
  final x = await picker.pickImage(
    source: choice == 'camera' ? ImageSource.camera : ImageSource.gallery,
    // Avatar için küçük tut — web 320px ile aynı ölçek.
    maxWidth: 480,
    maxHeight: 480,
    imageQuality: 80,
  );
  if (x == null) return null;
  final bytes = await x.readAsBytes();
  return 'data:image/jpeg;base64,${base64Encode(bytes)}';
}
