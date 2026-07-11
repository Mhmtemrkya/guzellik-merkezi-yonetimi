# BeautyAssist — release R8/ProGuard kuralları.
# Flutter engine kuralları Flutter Gradle plugin tarafından otomatik gelir; buradakiler
# eklenti-özel keep'ler (minify açıkken reflection/JNI kaynaklı çökmeleri önler).

# --- Flutter ---
-keep class io.flutter.** { *; }
-dontwarn io.flutter.**

# --- Firebase Cloud Messaging (opsiyonel push) ---
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# --- flutter_local_notifications (Gson + zamanlanmış bildirim modelleri) ---
-keep class com.dexterous.** { *; }
-keep class com.google.gson.** { *; }
-keep class * extends com.google.gson.TypeAdapter
-keepattributes Signature
-keepattributes *Annotation*
# Gson generic tip bilgisi minify'de silinmesin
-keep class com.dexterous.flutterlocalnotifications.models.** { *; }

# --- flutter_background_service ---
-keep class id.flutter.flutter_background_service.** { *; }

# --- Genel: parcelable/serializable & enum ---
-keepclassmembers enum * { *; }
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}
