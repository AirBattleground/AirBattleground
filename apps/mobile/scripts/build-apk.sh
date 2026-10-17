#!/usr/bin/env bash
# Local signed release build of 7XEN Manager (no EAS). Usage: npm run build:apk
# Signing: SEVENXEN_UPLOAD_* in ~/.gradle/gradle.properties (keystore in ~/.local/share/7xen-android/keys/).
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-$HOME/.local/share/7xen-android/jdk17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/.local/share/7xen-android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME" PATH="$JAVA_HOME/bin:$PATH" NODE_ENV=production
npx expo prebuild --platform android --no-install
(cd android && ./gradlew assembleRelease -x lint)
ls -la android/app/build/outputs/apk/release/
