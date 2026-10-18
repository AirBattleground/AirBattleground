// Standalone JVM harness for the on-device screen detector.
// Compiles the SAME Kotlin sources the Android app ships (no android.* imports) and runs JUnit 5 over the
// labelled BGMI screenshots in datasets/bgmi-screenshots.
plugins {
    kotlin("jvm") version "2.2.0"
}

repositories { mavenCentral() }

val detectorSrc = rootDir.resolve("../../apps/mobile/modules/gameops/android/src/main/java/com/sevenxen/gameops/detector")

sourceSets {
    main { kotlin.srcDir(detectorSrc) }
}

kotlin { jvmToolchain(17) }

dependencies {
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
    maxHeapSize = "2g"
    systemProperty("repoRoot", rootDir.resolve("../..").canonicalPath)
    // forward -Dverbose=1 (print every frame's features)
    System.getProperty("verbose")?.let { systemProperty("verbose", it) }
    // -Doverlay=1: write frames with the detected viewport / panel to build/overlays/
    System.getProperty("overlay")?.let { systemProperty("overlay", layout.buildDirectory.dir("overlays").get().asFile.path) }
    testLogging {
        events("failed")
        showStandardStreams = true
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
    outputs.upToDateWhen { false }
}
