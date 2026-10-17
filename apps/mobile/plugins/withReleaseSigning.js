/**
 * Signs release builds with the 7XEN Manager keystore when its Gradle properties are set
 * (kept OUT of the repo, in ~/.gradle/gradle.properties or ORG_GRADLE_PROJECT_* env vars):
 *   SEVENXEN_UPLOAD_STORE_FILE, SEVENXEN_UPLOAD_STORE_PASSWORD, SEVENXEN_UPLOAD_KEY_ALIAS, SEVENXEN_UPLOAD_KEY_PASSWORD
 * Without them the release build falls back to the debug key (and says so).
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// 7xen-release-signing";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARK)) return cfg;
    g = g.replace(
      /signingConfigs \{\n(\s+)debug \{/,
      `signingConfigs {
        ${MARK}
        release {
            if (project.hasProperty('SEVENXEN_UPLOAD_STORE_FILE')) {
                storeFile file(SEVENXEN_UPLOAD_STORE_FILE)
                storePassword SEVENXEN_UPLOAD_STORE_PASSWORD
                keyAlias SEVENXEN_UPLOAD_KEY_ALIAS
                keyPassword SEVENXEN_UPLOAD_KEY_PASSWORD
            }
        }
$1debug {`,
    );
    g = g.replace(
      /(release \{\n\s+\/\/ Caution![^\n]*\n[^\n]*\n\s+)signingConfig signingConfigs\.debug/,
      `$1signingConfig project.hasProperty('SEVENXEN_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
    );
    if (!g.includes("signingConfigs.release :")) throw new Error("withReleaseSigning: couldn't patch app/build.gradle");
    cfg.modResults.contents = g;
    return cfg;
  });
};
