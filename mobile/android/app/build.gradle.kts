plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// FCM: google-services.json bırakılırsa Firebase yapılandırması derlemeye enjekte edilir.
// Dosya yoksa plugin uygulanmaz → build normal devam eder; firebase_messaging derlenir ama
// Firebase.initializeApp() runtime'da guard'lı hata verir (uygulama yerel+LAN ile çalışır).
if (project.file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.beautyasist.beautyasist_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        // flutter_local_notifications v18 java.time API'lerini eski Android'de kullanabilmek için
        // core library desugaring ŞART (yoksa zamanlanmış bildirim derlenmez/çalışmaz).
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.beautyasist.beautyasist_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    // core library desugaring (flutter_local_notifications v18 için gerekli)
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
