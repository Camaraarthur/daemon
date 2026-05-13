plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.daemon.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.daemon.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 13
        versionName = "1.6.0-hover-upload-wired"

        buildConfigField("String", "API_BASE_URL", "\"https://my.daemon.page/\"")
        buildConfigField("String", "DAEMON_WS_URL", "\"wss://my.daemon.page/ws/device\"")
        // slice-e: empty seed → forces scan on first run so we bond whichever
        // DaemonPendant-* is actually nearby. Hard-coding a single MAC was a
        // landmine: stale bond from a previous board (4A:D1) blocked the live
        // pendant (4A:D2) from ever connecting. The watchdog now clears stale
        // bonds after N consecutive GATT_FAILURE disconnects (see
        // PendantBridgeService.startReconnectWatchdog).
        buildConfigField("String", "PENDANT_DEFAULT_MAC", "\"\"")
    }

    signingConfigs {
        create("release") {
            storeFile = file("../daemon-release.keystore")
            storePassword = "daemonpage"
            keyAlias = "daemon"
            keyPassword = "daemonpage"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
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
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.service)
    implementation(libs.activity.compose)

    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.coroutines.core)
    implementation(libs.coroutines.android)
    implementation(libs.core.ktx)
    implementation(libs.camera2)
    implementation(libs.camera.core)
    implementation(libs.camera.lifecycle)
}
