import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../shared/widgets/async_list_page.dart';

typedef LiveQueryBuilder = Map<String, dynamic> Function();
typedef LivePayloadLoader = Future<dynamic> Function(ApiClient api);

class LiveListScreen extends StatelessWidget {
  const LiveListScreen({
    required this.api,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.endpoint,
    required this.titleKeys,
    required this.subtitleKeys,
    this.query,
    this.loader,
    this.trailingKeys = const [],
    this.statusKeys = const [],
    this.emptyText = 'Canlı veride kayıt bulunmuyor.',
    super.key,
  });

  final ApiClient api;
  final String eyebrow;
  final String title;
  final String subtitle;
  final IconData icon;
  final String endpoint;
  final LiveQueryBuilder? query;
  final LivePayloadLoader? loader;
  final List<String> titleKeys;
  final List<String> subtitleKeys;
  final List<String> trailingKeys;
  final List<String> statusKeys;
  final String emptyText;

  @override
  Widget build(BuildContext context) => AsyncListPage(
    eyebrow: eyebrow,
    title: title,
    subtitle: subtitle,
    loader: loader != null
        ? () => loader!(api)
        : () => api.get(endpoint, query: query?.call()),
    icon: icon,
    titleKeys: titleKeys,
    subtitleKeys: subtitleKeys,
    trailingKeys: trailingKeys,
    statusKeys: statusKeys,
    emptyText: emptyText,
  );
}

Map<String, dynamic> pageQuery([Map<String, dynamic>? extra]) => {
  'page': 1,
  'pageSize': 200,
  if (extra != null) ...extra,
};
