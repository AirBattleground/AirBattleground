// Metro: the app lives outside the pnpm workspace but shares code with it.
// @7xen/shared is read straight from ../../packages/shared/src (watchFolders), and every bare import
// coming from there (zod, …) is resolved from THIS app's node_modules, so there is a single copy of each
// and pnpm's symlinked packages/shared/node_modules is never used.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "../../packages/shared");
const sharedSrc = path.join(sharedRoot, "src");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), sharedSrc];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.blockList = [/packages[\/\\]shared[\/\\]node_modules[\/\\].*/];

const isBare = (name) => !name.startsWith(".") && !path.isAbsolute(name);
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (moduleName === "@7xen/shared") {
    return { type: "sourceFile", filePath: path.join(sharedSrc, "index.ts") };
  }
  if (isBare(moduleName) && context.originModulePath.startsWith(sharedRoot + path.sep)) {
    // pretend the import comes from the app so node_modules lookup starts at apps/mobile
    return resolve({ ...context, originModulePath: path.join(projectRoot, "index.js") }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
