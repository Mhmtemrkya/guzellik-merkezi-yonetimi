/// Kişi adı kurum standardı: ad(lar) "İlk harf büyük", soyad TAMAMI BÜYÜK.
/// "ayşe nur yilmaz" → "Ayşe Nur YILMAZ".
///
/// Dart'ın toUpperCase/toLowerCase'i locale duyarsız olduğundan Türkçe i/I
/// çiftleri elle eşlenir. Web'deki formatPersonName ve backend'deki
/// PersonNameFormatter ile aynı kuralı uygular.
library;

const _upperMap = {'i': 'İ', 'ı': 'I', 'ğ': 'Ğ', 'ü': 'Ü', 'ş': 'Ş', 'ö': 'Ö', 'ç': 'Ç'};
const _lowerMap = {'I': 'ı', 'İ': 'i', 'Ğ': 'ğ', 'Ü': 'ü', 'Ş': 'ş', 'Ö': 'ö', 'Ç': 'ç'};

String _upperTr(String c) => _upperMap[c] ?? c.toUpperCase();
String _lowerTr(String c) => _lowerMap[c] ?? c.toLowerCase();

String formatPersonName(String? value) {
  final parts = (value ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '';
  // Tek kelime soyad değil ad kabul edilir.
  if (parts.length == 1) return _titleCase(parts.first);

  final head = parts.sublist(0, parts.length - 1).map(_titleCase);
  final last = parts.last.split('').map(_upperTr).join();
  return [...head, last].join(' ');
}

String _titleCase(String word) {
  // Tireli/kesme işaretli adlar parça parça büyütülür: "ayşe-nur" → "Ayşe-Nur".
  var startOfWord = true;
  final buffer = StringBuffer();
  for (final ch in word.split('')) {
    if (ch == '-' || ch == "'" || ch == '’' || ch == '.') {
      buffer.write(ch);
      startOfWord = true;
      continue;
    }
    buffer.write(startOfWord ? _upperTr(ch) : _lowerTr(ch));
    startOfWord = false;
  }
  return buffer.toString();
}
