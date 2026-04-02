# Moshi
-keep class com.mirror.app.data.remote.dto.** { *; }
-keepclassmembers class com.mirror.app.data.remote.dto.** { *; }

# Retrofit
-keepattributes Signature
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * { @retrofit2.http.* <methods>; }
