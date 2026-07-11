import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release imzalama: key.properties (gitignore'da) varsa gerçek keystore ile imzalanır.
// Dosya yoksa release yine debug anahtarıyla imzalanır (yerel `flutter run --release` çalışsın diye);
// ama Play'e yükleme için key.properties ŞART — bkz. STORE_YAYIN_REHBERI.md.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

// FCM: google-services.json bırakılırsa Firebase yapılandırması derlemeye enjekte edilir.
// Dosya yoksa plugin uygulanmaz → build normal devam eder; firebase_messaging derlenir ama
// Firebase.initializeApp() runtime'da guard'lı hata verir (uygulama yerel+LAN ile çalışır).
if (project.file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.beautyassist.beautyassist_mobile"
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
        // Firebase/Play uygulama kimliği (FCM google-services.json'daki package_name ile birebir eşleşmeli).
        // Not: Kotlin namespace ayrı kalabilir; FCM ve Play yalnızca applicationId'yi baz alır.
        applicationId = "com.beautyassist.app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = keystoreProperties["storeFile"]?.let { rootProject.file(it) }
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            // key.properties varsa gerçek keystore, yoksa debug (yalnızca yerel test için).
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }

            // R8/kod küçültme + kaynak temizleme — store için daha küçük ve zorlaştırılmış APK/AAB.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
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
