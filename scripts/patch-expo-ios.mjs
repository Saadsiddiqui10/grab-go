// Makes Expo SDK 57's iOS build work with Xcode 26.3 (Swift 6.2) and in a
// folder whose path contains `&`.
//
// Expo 57 is written against a newer Swift, and Swift 6.2 rejects three things:
//
// 1. SWIFT_RETURNS_RETAINED on constructors of SWIFT_SHARED_REFERENCE types
//    (expo-modules-jsi RuntimeScheduler.h). Swift 6.2 already treats such
//    constructors as returning +1, matching the class's initial refCount of 1,
//    so dropping the annotation keeps semantics.
// 2. "sending ... risks causing data races" for nonisolated(unsafe) pointer
//    captures in expo-modules-jsi JavaScriptRuntime.swift. Those closures run
//    synchronously inside assumeIsolated, so the pointers are passed through an
//    @unchecked Sendable box instead.
// 3. The same diagnostic for `nonisolated(unsafe) weak let emitter = self` in
//    expo-modules-core EventEmitter.swift, replaced with a weak Sendable box.
//
// Separately, expo-constants runs its app-config script phase as
// `bash -l -c "$PODS_TARGET_SRCROOT/..."`, so the inner shell re-parses the
// expanded path and `&` in the repository folder name splits the command.
// Single-quoting the path for the inner shell fixes it; rerun `pod install`
// after this changes the podspec.
//
// Runs on postinstall and is idempotent. The Swift sections can go once the
// toolchain is Xcode 26.4+ (Swift 6.3).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const nodeModules = new URL('../node_modules/', import.meta.url);

function patch(relativePath, from, to) {
  const file = new URL(relativePath, nodeModules);
  if (!existsSync(file)) return;
  const source = readFileSync(file, 'utf8');
  const patched = source.replace(from, to);
  if (patched !== source) {
    writeFileSync(file, patched);
    console.log(`Patched ${relativePath}`);
  }
}

// Appends `declaration` to the file unless `marker` is already present.
function append(relativePath, marker, declaration) {
  patch(
    relativePath,
    new RegExp(`^(?![\\s\\S]*${marker})([\\s\\S]*?)\\n?$(?![\\s\\S])`),
    `$1\n\n/// Workaround for Swift 6.2 region isolation; see scripts/patch-expo-ios.mjs.\n${declaration}`,
  );
}

/* ------------------------------------------------------------ expo-modules-jsi */

patch(
  'expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h',
  /SWIFT_RETURNS_RETAINED (RuntimeScheduler\()/g,
  '$1',
);

const runtimeFile = 'expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/JavaScriptRuntime.swift';
const box = (names) => names.map((n) => `let ${n}Box = Swift62SendableBox(${n})`);
const unbox = (names) => names.map((n) => `let ${n} = ${n}Box.value`);

// Host object getter: only resultPtr crosses the closure boundary.
patch(
  runtimeFile,
  /nonisolated\(unsafe\) let resultPtr = resultPtr\n(\s*\n\s*return withGuaranteedContext\(context\) \{ \(context: HostObjectContext, runtime\) in\n\s*return JavaScriptActor\.assumeIsolated \{\n\s*return forwardingSwiftErrorsToJS\(runtime: runtime\) \{\n)(\s*)/,
  `${box(['resultPtr'])[0]}\n$1$2${unbox(['resultPtr'])[0]}\n$2`,
);

// Both host function closures: this, arguments and result pointers.
const ptrs = ['thisPtr', 'argumentsPtr', 'resultPtr'];
patch(
  runtimeFile,
  /( *)nonisolated\(unsafe\) let thisPtr = thisPtr\n\s*nonisolated\(unsafe\) let argumentsPtr = argumentsPtr\n\s*nonisolated\(unsafe\) let resultPtr = resultPtr\n((?:.*\n)*?\s*return forwardingSwiftErrorsToJS\(runtime: runtime\) \{\n)(\s*)/g,
  (_, indent, middle, inner) =>
    box(ptrs).map((l) => indent + l).join('\n') + '\n' + middle + inner + unbox(ptrs).join('\n' + inner) + '\n' + inner,
);

append(
  runtimeFile,
  'struct Swift62SendableBox',
  'struct Swift62SendableBox<T>: @unchecked Sendable {\n  let value: T\n  init(_ value: T) { self.value = value }\n}\n',
);

/* ----------------------------------------------------------- expo-modules-core */

// npm may hoist expo-modules-core or nest it under expo, depending on the tree.
for (const core of ['expo-modules-core', 'expo/node_modules/expo-modules-core']) {
  const emitterFile = `${core}/ios/Core/Events/EventEmitter.swift`;
  patch(emitterFile, /nonisolated\(unsafe\) weak let emitter = self/g, 'let emitterBox = Swift62WeakBox(self)');
  patch(emitterFile, /guard let emitter(,| else)/g, 'guard let emitter = emitterBox.value$1');
  append(
    emitterFile,
    'struct Swift62WeakBox',
    'struct Swift62WeakBox<T: AnyObject>: @unchecked Sendable {\n  weak var value: T?\n  init(_ value: T) { self.value = value }\n}\n',
  );
}

/* -------------------------------------------------------------- expo-constants */

patch(
  'expo-constants/ios/EXConstants.podspec',
  '#{env_vars}$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\"',
  "#{env_vars}'$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh'\\\"",
);
