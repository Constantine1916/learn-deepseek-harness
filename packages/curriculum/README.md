# @learn-dsh/curriculum

Versioned Learn DSH curriculum data and its validation boundary. The package loads the bundled foundations manifest, validates its schema, SemVer ranges, graph references, safe relative paths, and optionally verifies source anchors against a resolved DeepSeek Harness checkout.

The default service can load without a source checkout so an installed profile remains portable. Pass `sourceRoot` in plugin configuration, or call `verifySources(sourceRoot)`, at the first point where DSH sources are available; missing files, symlink escapes, and stale anchors then fail explicitly.

The bundled foundations course contains four prerequisite-linked units covering all eight MVP learning outcomes, with a source-inspection exercise, two code exercises, and one integration exercise. Every unit has three ordered hints; the loader rejects fenced code, complete-solution language, and oversized content in levels one and two.
