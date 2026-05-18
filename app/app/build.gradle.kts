plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "dev.daemon.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.daemon.app"
        minSdk = 28
        targetSdk = 35
        versionCode = 2
        versionName = "0.1.1"

        // Phone-first target. Pixel 8 Pro, Pixel 9, Samsung S24+, etc. are all
        // arm64-v8a. Dropping the other ABIs cuts APK size by ~60% (the bulk
        // was duplicated SQLCipher + Filament native libs).
        // When iOS lands we'll keep this same arm64-only Android slice.
        ndk {
            abiFilters += setOf("arm64-v8a")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/DEPENDENCIES",
                "/META-INF/LICENSE",
                "/META-INF/LICENSE.txt",
                "/META-INF/NOTICE",
                "/META-INF/NOTICE.txt",
            )
        }
    }
}

dependencies {
    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)

    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    implementation(libs.compose.foundation)
    implementation(libs.compose.animation)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.activity.compose)

    implementation(libs.coroutines.core)
    implementation(libs.coroutines.android)
    implementation(libs.core.ktx)

    // Required for the AppCompat-style XML theme parent (Theme.Material3.*).
    implementation(libs.android.material)

    // ML Kit GenAI Prompt — on-device Gemini Nano on Pixel 8 Pro / 9 / S24+.
    implementation(libs.mlkit.genai.prompt)

    // BYOK: direct HTTPS to provider with OkHttp + auditable egress.
    implementation(libs.okhttp)
    // Encrypted SharedPreferences — Android Keystore-backed key storage.
    implementation(libs.security.crypto)

    // Biometric-gated vault key + SQLCipher-encrypted SQLite vault.
    implementation(libs.biometric)
    implementation(libs.sqlcipher.android)
    implementation(libs.fragment.ktx)
    // AndroidX SQLite — required on classpath by net.zetetic:sqlcipher-android.
    implementation(libs.sqlite)
    implementation(libs.sqlite.ktx)

    // ML Kit on-device Text Recognition v2 — used by ScreenshotWatcher to OCR
    // new screenshots into chat context.
    implementation(libs.mlkit.text.recognition)
}
