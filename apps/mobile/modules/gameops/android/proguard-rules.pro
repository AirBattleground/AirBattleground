# GameOps consumer rules (applied to the app's R8 pass via consumerProguardFiles).
# Detector: called directly now, kept anyway so its public API/data classes survive minification unchanged.
-keep class com.sevenxen.gameops.detector.** { *; }
# Expo module entry (instantiated by name from the autolinking package list).
-keep class com.sevenxen.gameops.GameOpsModule { *; }
# Components declared in the manifest / instantiated by the framework by class name.
-keep class com.sevenxen.gameops.capture.CaptureService { *; }
-keep class com.sevenxen.gameops.automation.AutomationService { *; }
-keep class com.sevenxen.gameops.upload.VideoUploadWorker { *; }
