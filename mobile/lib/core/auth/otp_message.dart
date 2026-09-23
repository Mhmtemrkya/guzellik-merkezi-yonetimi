/// The server identifies configured demo accounts; never infer them from a phone.
String customerOtpMessage(Map<String, dynamic> response,
    {bool registration = false}) {
  final message = response['message']?.toString().trim() ?? '';
  final hint = response['hint']?.toString().trim() ?? '';
  if (response['isDemo'] == true && message.isNotEmpty) return message;
  final code = response['devCode']?.toString() ?? '';
  final base = code.isNotEmpty
      ? 'Test ortamı doğrulama kodu: $code'
      : message.isNotEmpty
          ? message
          : registration
              ? 'Doğrulama kodunu kayıt için yazdığınız e-posta kutusunda kontrol edin.'
              : 'Bilgileriniz eşleşiyorsa doğrulama kodu kayıtlı e-posta adresinize gönderilir.';
  return hint.isEmpty || hint == base ? base : '$base $hint';
}
