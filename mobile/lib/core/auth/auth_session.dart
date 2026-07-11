class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAtUtc,
    required this.user,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime expiresAtUtc;
  final SessionUser user;

  factory AuthSession.fromJson(Map<String, dynamic> json) => AuthSession(
    accessToken: json['accessToken'] as String? ?? '',
    refreshToken: json['refreshToken'] as String? ?? '',
    expiresAtUtc:
        DateTime.tryParse(json['expiresAtUtc'] as String? ?? '') ??
        DateTime.now(),
    user: SessionUser.fromJson(
      (json['user'] as Map?)?.cast<String, dynamic>() ?? const {},
    ),
  );

  Map<String, dynamic> toJson() => {
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'expiresAtUtc': expiresAtUtc.toIso8601String(),
    'user': user.toJson(),
  };
}

class SessionUser {
  const SessionUser({
    required this.id,
    required this.email,
    required this.fullName,
    required this.role,
    required this.tenantId,
    required this.branchId,
    required this.permissions,
    required this.mustChangePassword,
    this.customerId,
  });

  final String id;
  final String email;
  final String fullName;
  final String role;
  final String? tenantId;
  final String? branchId;
  final String? customerId;
  final List<String> permissions;
  final bool mustChangePassword;

  bool get isPlatform => role == 'PlatformAdmin';
  bool get isStaff => role == 'Staff';
  bool get isCustomer => role == 'Customer';
  String get initials {
    final parts = fullName.trim().split(RegExp(r'\s+'));
    return parts.where((e) => e.isNotEmpty).take(2).map((e) => e[0]).join();
  }

  factory SessionUser.fromJson(Map<String, dynamic> json) => SessionUser(
    id: '${json['userId'] ?? json['id'] ?? ''}',
    email: '${json['email'] ?? ''}',
    fullName: '${json['fullName'] ?? json['email'] ?? 'BeautyAssist'}',
    role: '${json['role'] ?? 'Staff'}',
    tenantId: json['tenantId']?.toString(),
    branchId: json['branchId']?.toString(),
    customerId: json['customerId']?.toString(),
    permissions: ((json['permissions'] as List?) ?? const [])
        .map((e) => e.toString())
        .toList(),
    mustChangePassword: json['mustChangePassword'] == true,
  );

  Map<String, dynamic> toJson() => {
    'userId': id,
    'email': email,
    'fullName': fullName,
    'role': role,
    'tenantId': tenantId,
    'branchId': branchId,
    'customerId': customerId,
    'permissions': permissions,
    'mustChangePassword': mustChangePassword,
  };
}
