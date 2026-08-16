# @learn-dsh/curriculum

Versioned Learn DSH curriculum data and its validation boundary. The package loads the bundled foundations manifest, validates its schema, SemVer ranges, graph references, safe relative paths, and optionally verifies source anchors against a resolved DeepSeek Harness checkout.

The default service can load without a source checkout so an installed profile remains portable. Pass `sourceRoot` in plugin configuration, or call `verifySources(sourceRoot)`, at the first point where DSH sources are available; missing files, symlink escapes, and stale anchors then fail explicitly.
