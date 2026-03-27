# Lisp Bracket Matcher

`Lisp Bracket Matcher` is a Visual Studio Code extension for Lisp-family languages that fixes bracket matching in cases where the default matcher is not precise enough.

It is designed specifically to solve escaped bracket matching issues such as `\#(` and `\#)`, while still correctly recognizing real Lisp forms like `(`, `#(`, and `#vu8(`. This makes editing Scheme, Racket, and Lisp code more reliable when your source contains vectors, bytevectors, or escaped reader syntax.

## Why This Extension

In Lisp code, not every parenthesis-like sequence should participate in structural matching.

Examples:

- `#(` is a real vector opener and should be matched.
- `#vu8(` is a real bytevector opener and should be matched.
- `\#(` is an escaped sequence and should be ignored.
- `\#)` is an escaped sequence and should also be ignored.

Default bracket matching can treat these cases too simplistically. This extension adds Lisp-aware matching behavior so the editor highlights the correct pair and avoids false positives caused by escaped syntax.

## Features

- Correctly matches standard list parentheses: `(` ... `)`
- Supports vector forms: `#(`
- Supports bytevector forms: `#vu8(`
- Ignores escaped sequences such as `\#(` and `\#)`
- Highlights matching brackets in supported files
- Provides optional diagnostics for unmatched parentheses and vector openers
- Works with `scheme`, `racket`, and `lisp` language modes

## Installation

### From the VS Code Marketplace

1. Open Visual Studio Code.
2. Go to the Extensions view.
3. Search for `Lisp Bracket Matcher`.
4. Click `Install`.

### From a VSIX Package

1. Open the Extensions view in VS Code.
2. Select `...` in the top-right corner.
3. Choose `Install from VSIX...`.
4. Select the extension package file.

## Usage

Open a Scheme, Racket, or Lisp file and place the cursor on a bracket token. The extension will highlight the matching bracket using Lisp-aware rules.

### Example 1: Standard list matching

```scheme
(define (square x)
  (* x x))
```

Placing the cursor on either `(` or `)` highlights the correct matching pair.

### Example 2: Vector and bytevector matching

```scheme
(define vec #(1 2 3))
(define bytes #vu8(65 66 67))
```

The extension treats `#(` and `#vu8(` as valid opening bracket tokens and matches them against their closing `)`.

### Example 3: Escaped sequences are ignored

```scheme
(display "\\#(")
(display "\\#)")
```

The sequences `\#(` and `\#)` are ignored by the matcher, so they do not interfere with structural navigation or bracket highlighting.

## Configuration

This extension contributes the following settings:

### `lispBracketMatcher.enableDiagnostics`

- Type: `boolean`
- Default: `true`

Enables diagnostics for unmatched opening and closing parentheses in supported documents.

### `lispBracketMatcher.debounceMs`

- Type: `number`
- Default: `120`

Controls the delay, in milliseconds, before the document is rescanned after edits. Increase this value if you want fewer rescans during rapid typing.

### Example settings

```json
{
  "lispBracketMatcher.enableDiagnostics": true,
  "lispBracketMatcher.debounceMs": 120
}
```

## Works Well with Rainbow Brackets Extensions

`Lisp Bracket Matcher` and rainbow bracket plugins solve different problems and can be used together.

- Use `Lisp Bracket Matcher` for correct structural matching of `(`, `#(`, and `#vu8(`, while ignoring escaped sequences like `\#(`.
- Use a rainbow bracket extension for visual depth coloring of nested parentheses.

Recommended setup:

- Keep this extension enabled for accurate Lisp-aware matching.
- Use your preferred rainbow bracket extension for nested color visualization.
- Let this extension handle bracket matching behavior in supported Lisp files.

## License

This project is licensed under the Apache License 2.0.

See the `LICENSE` file if it is included with the project distribution, or refer to the Apache 2.0 license text at:

https://www.apache.org/licenses/LICENSE-2.0
