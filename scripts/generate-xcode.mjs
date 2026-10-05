// A dependency-free wrapper generator. Extension resources stay linked to the
// source folder, so rebuilding always packages the current JavaScript.
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const projectPath = resolve(root, 'build/safari/QuietTube/QuietTube.xcodeproj');
const objects = new Map();
let sequence = 0;
const id = () => (++sequence).toString(16).padStart(24, '0').toUpperCase();
const add = object => { const key = id(); objects.set(key, object); return key; };
const ref = value => ({ ref: value });
const file = (path, type, sourceTree = '<absolute>') => add({ isa: 'PBXFileReference', lastKnownFileType: type, path, sourceTree });
const buildFile = (fileRef, settings) => add({ isa: 'PBXBuildFile', fileRef: ref(fileRef), ...(settings ? { settings } : {}) });
const phase = (isa, files, extra = {}) => add({ isa, buildActionMask: 2147483647, files: files.map(ref), runOnlyForDeploymentPostprocessing: 0, ...extra });
const configs = settings => add({ isa: 'XCConfigurationList', buildConfigurations: ['Debug', 'Release'].map(name => ref(add({ isa: 'XCBuildConfiguration', buildSettings: { ...settings, SWIFT_OPTIMIZATION_LEVEL: name === 'Debug' ? '-Onone' : '-O' }, name }))), defaultConfigurationIsVisible: 0, defaultConfigurationName: 'Debug' });

const appSource = file(resolve(root, 'native/App.swift'), 'sourcecode.swift');
const handler = file(resolve(root, 'native/ExtensionHandler.swift'), 'sourcecode.swift');
const resources = [];
for (const name of (await readdir(resolve(root, 'extension'))).sort()) {
  const type = name === 'rules' ? 'folder' : name.endsWith('.js') ? 'sourcecode.javascript' : name.endsWith('.json') ? 'text.json' : name.endsWith('.css') ? 'text.css' : 'text.html';
  resources.push(file(resolve(root, 'extension', name), type));
}
const appProduct = file('QuietTube.app', 'wrapper.application', 'BUILT_PRODUCTS_DIR');
const extensionProduct = file('QuietTubeExtension.appex', 'wrapper.app-extension', 'BUILT_PRODUCTS_DIR');
const products = add({ isa: 'PBXGroup', children: [ref(appProduct), ref(extensionProduct)], name: 'Products', sourceTree: '<group>' });
const resourceGroup = add({ isa: 'PBXGroup', children: resources.map(ref), name: 'Web Extension', sourceTree: '<group>' });
const mainGroup = add({ isa: 'PBXGroup', children: [ref(appSource), ref(handler), ref(resourceGroup), ref(products)], sourceTree: '<group>' });
const common = {
  SDKROOT: 'macosx', MACOSX_DEPLOYMENT_TARGET: '13.0', SWIFT_VERSION: '5.0',
  CODE_SIGN_ENTITLEMENTS: resolve(root, 'native/QuietTube.entitlements'), CODE_SIGN_IDENTITY: '-', CODE_SIGN_STYLE: 'Manual',
  CLANG_MODULE_CACHE_PATH: resolve(root, 'build/ModuleCache'), SWIFT_MODULE_CACHE_PATH: resolve(root, 'build/ModuleCache'),
  ENABLE_APP_SANDBOX: 'YES', ENABLE_HARDENED_RUNTIME: 'YES'
};
const extensionTarget = add({
  isa: 'PBXNativeTarget', name: 'QuietTubeExtension', productName: 'QuietTubeExtension', productReference: ref(extensionProduct), productType: 'com.apple.product-type.app-extension',
  buildConfigurationList: ref(configs({ ...common, PRODUCT_BUNDLE_IDENTIFIER: 'dev.local.quiettube.Extension', PRODUCT_NAME: 'QuietTubeExtension', INFOPLIST_FILE: resolve(root, 'native/Extension-Info.plist'), SKIP_INSTALL: 'YES', APPLICATION_EXTENSION_API_ONLY: 'YES', LD_RUNPATH_SEARCH_PATHS: ['$(inherited)', '@executable_path/../Frameworks', '@executable_path/../../../../Frameworks'] })),
  buildPhases: [ref(phase('PBXSourcesBuildPhase', [buildFile(handler)])), ref(phase('PBXFrameworksBuildPhase', [])), ref(phase('PBXResourcesBuildPhase', resources.map(resource => buildFile(resource))))],
  buildRules: [], dependencies: []
});
const projectId = id();
const proxy = add({ isa: 'PBXContainerItemProxy', containerPortal: ref(projectId), proxyType: 1, remoteGlobalIDString: extensionTarget, remoteInfo: 'QuietTubeExtension' });
const dependency = add({ isa: 'PBXTargetDependency', target: ref(extensionTarget), targetProxy: ref(proxy) });
const appTarget = add({
  isa: 'PBXNativeTarget', name: 'QuietTube', productName: 'QuietTube', productReference: ref(appProduct), productType: 'com.apple.product-type.application',
  buildConfigurationList: ref(configs({ ...common, PRODUCT_BUNDLE_IDENTIFIER: 'dev.local.quiettube', PRODUCT_NAME: 'QuietTube', INFOPLIST_FILE: resolve(root, 'native/App-Info.plist'), LD_RUNPATH_SEARCH_PATHS: ['$(inherited)', '@executable_path/../Frameworks'] })),
  buildPhases: [ref(phase('PBXSourcesBuildPhase', [buildFile(appSource)])), ref(phase('PBXFrameworksBuildPhase', [])), ref(phase('PBXResourcesBuildPhase', [])), ref(phase('PBXCopyFilesBuildPhase', [buildFile(extensionProduct, { ATTRIBUTES: ['RemoveHeadersOnCopy'] })], { dstPath: '', dstSubfolderSpec: 13, name: 'Embed Extension' }))],
  buildRules: [], dependencies: [ref(dependency)]
});
objects.set(projectId, {
  isa: 'PBXProject', attributes: { BuildIndependentTargetsInParallel: 'YES', LastUpgradeCheck: '2600' },
  buildConfigurationList: ref(configs({ CLANG_ENABLE_MODULES: 'YES', ALWAYS_SEARCH_USER_PATHS: 'NO', SWIFT_VERSION: '5.0' })),
  compatibilityVersion: 'Xcode 14.0', developmentRegion: 'en', hasScannedForEncodings: 0,
  knownRegions: ['en', 'Base'], mainGroup: ref(mainGroup), productRefGroup: ref(products),
  projectDirPath: '', projectRoot: '', targets: [ref(appTarget), ref(extensionTarget)]
});
function serialize(value) {
  if (value && value.ref) return value.ref;
  if (Array.isArray(value)) return '(' + value.map(serialize).join(', ') + ')';
  if (value && typeof value === 'object') return '{\n' + Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${serialize(entry)};`).join('\n') + '\n}';
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}
await mkdir(projectPath, { recursive: true });
await writeFile(resolve(projectPath, 'project.pbxproj'), '// !$*UTF8*$!\n' + serialize({ archiveVersion: 1, classes: {}, objectVersion: 56, objects: Object.fromEntries(objects), rootObject: ref(projectId) }) + '\n');
console.log(`Generated ${projectPath}`);
