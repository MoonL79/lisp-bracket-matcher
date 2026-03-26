# Lisp Bracket Matcher

VSCode extension to handle bracket matching for Lisp/Scheme, excluding escaped brackets like `\#(` and `\#)`.

Features:

- Ignores escaped bracket sequences before any normal bracket detection runs
- Supports list forms `(`, vector forms `#(`, and bytevector forms `#vu8(`
- Highlights matching brackets in visible editor ranges
- Optional diagnostics for unbalanced parentheses

Settings:

- `lispBracketMatcher.enableDiagnostics`: enable or disable unbalanced bracket diagnostics
- `lispBracketMatcher.debounceMs`: delay rescans after document edits to reduce repeated work
