# Android Security Research

Verify the current program scope before acquiring a target. An app being available through Google Play
does not make it a Google Mobile VRP target. Record its publisher, package name, program/tier, version,
and the rule page used for the scope decision. Device codenames and historical Google hardware are not
proof that the latest supported build remains eligible.

## Freeze the target

For an application, retain:

- base and split APKs from the same installed package;
- package name, version name/code, installer, signing-certificate digest, and APK SHA-256 values;
- acquisition source/time and whether bytes came from a device, store bundle, or firmware image;
- device build fingerprint, Android version, security patch level, architecture, and SELinux state.

For firmware, also record image/build identifiers, partition or package origin, extraction tools, and
hashes of every analyzed APK/APEX/JAR/DEX/native library. Never mix classes or resources from different
builds without labeling the comparison.

## Static context map

Start with the manifest and package state, then trace into code:

- exported activities, services, receivers, providers, permissions, intent filters, URI/path grants,
  task/launch modes, backup/debug settings, network security configuration, and SDK levels;
- deep links, WebViews, JavaScript bridges, file/content URI handling, PendingIntents, notifications,
  account/auth flows, dynamic receivers, and callbacks;
- Binder services and interfaces, caller UID/user checks, `clearCallingIdentity`, global registries,
  death recipients, and lifecycle cleanup;
- JNI registration, native entry points, length/ownership conversions, shared memory, HAL/driver calls,
  parsers, and privileged filesystem or socket consumers.

Decompiled Java is a navigation aid. Resolve behavior-sensitive branches against smali/DEX, native
assembly, canonical source, or a controlled trace.

When an experimental Hypotenuse Jobs run is available, keep APKTool, JADX and smali as distinct
producers and preserve the derivation from root APK to effective DEX or extracted input. Ingest the
terminal status and provenance through the campaign ledger rather than treating a generated source
tree as the target itself. A missing derived input or incomplete function set keeps the receipt
`partial`; JADX Java remains `source-reference` evidence even when its bytes and producer identity are
runtime-verified.

## Device validation

Use only researcher-controlled devices/accounts and actions allowed by the program. Prefer a small
cross-UID test app or bounded ADB invocation that demonstrates the exact boundary. Record commands and
responses, and use a nearby unauthorized identity/input as a negative control.

Do not treat `adb shell` as an ordinary third-party app identity. State when shell, root, debuggable,
test keys, an unlocked bootloader, accessibility, VPN, device-owner, or developer options are required;
those prerequisites can change exploitability and reward scope.

Avoid destructive persistence, user-data collection, broad fuzzing against production services, and
tests on other people's accounts or devices. Restore modified settings and test packages after the run.

## Duplicate resistance

Compare the exact package/build against current release notes, Android Security Bulletins, Pixel
Bulletins, public advisories, program disclosures, and the user's local report/freeze corpus. Search by
the violated boundary and privileged consumer, not only the component name or exception text. A patch
in AOSP does not by itself prove the vendor package is fixed or affected; establish build correspondence.
