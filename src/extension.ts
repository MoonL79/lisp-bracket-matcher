import * as vscode from "vscode";

const SUPPORTED_LANGUAGES = new Set(["scheme", "racket", "lisp"]);
const OPEN_PAREN = "(";
const CLOSE_PAREN = ")";
const VECTOR_PREFIX = "#(";
const BYTEVECTOR_PREFIX = "#vu8(";
const ESCAPE_PREFIX = "\\";
const CONFIG_SECTION = "lispBracketMatcher";
const DEFAULT_DEBOUNCE_MS = 120;

type BracketKind = "open" | "close";
type BracketTokenType = "list" | "vector";

interface BracketToken {
  offset: number;
  length: number;
  kind: BracketKind;
  type: BracketTokenType;
}

let bracketDecoration: vscode.TextEditorDecorationType | undefined;
let diagnosticCollection: vscode.DiagnosticCollection | undefined;
let lastDecoratedEditor: vscode.TextEditor | undefined;
let pendingUpdate: ReturnType<typeof setTimeout> | undefined;
let pendingEditor: vscode.TextEditor | undefined;

export function activate(context: vscode.ExtensionContext): void {
  bracketDecoration = vscode.window.createTextEditorDecorationType({
    borderRadius: "3px",
    backgroundColor: new vscode.ThemeColor("editorBracketMatch.background"),
    border: "1px solid",
    borderColor: new vscode.ThemeColor("editorBracketMatch.border")
  });
  diagnosticCollection = vscode.languages.createDiagnosticCollection("lisp-bracket-matcher");

  context.subscriptions.push(bracketDecoration, diagnosticCollection);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      scheduleEditorUpdate(editor, 0);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      scheduleEditorUpdate(event.textEditor, 0);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      scheduleEditorUpdate(event.textEditor, 0);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;

      if (editor && event.document === editor.document) {
        scheduleEditorUpdate(editor);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        scheduleEditorUpdate(vscode.window.activeTextEditor, 0);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticCollection?.delete(document.uri);
    })
  );

  scheduleEditorUpdate(vscode.window.activeTextEditor, 0);
}

export function deactivate(): void {
  if (pendingUpdate) {
    clearTimeout(pendingUpdate);
    pendingUpdate = undefined;
  }

  if (bracketDecoration) {
    bracketDecoration.dispose();
    bracketDecoration = undefined;
  }

  if (diagnosticCollection) {
    diagnosticCollection.dispose();
    diagnosticCollection = undefined;
  }
}

function scheduleEditorUpdate(editor: vscode.TextEditor | undefined, delay = getDebounceDelay()): void {
  pendingEditor = editor;

  if (pendingUpdate) {
    clearTimeout(pendingUpdate);
  }

  pendingUpdate = setTimeout(() => {
    pendingUpdate = undefined;
    updateEditorState(pendingEditor);
  }, delay);
}

function updateEditorState(editor: vscode.TextEditor | undefined): void {
  if (lastDecoratedEditor && lastDecoratedEditor !== editor && bracketDecoration) {
    lastDecoratedEditor.setDecorations(bracketDecoration, []);
  }

  if (!editor || !bracketDecoration || !diagnosticCollection || !SUPPORTED_LANGUAGES.has(editor.document.languageId)) {
    if (editor && bracketDecoration) {
      editor.setDecorations(bracketDecoration, []);
    }
    if (editor) {
      diagnosticCollection?.delete(editor.document.uri);
    }
    lastDecoratedEditor = editor;
    return;
  }

  const visibleContext = analyzeVisibleRanges(editor);
  if (isDiagnosticsEnabled()) {
    diagnosticCollection.set(editor.document.uri, visibleContext.diagnostics);
  } else {
    diagnosticCollection.delete(editor.document.uri);
  }

  const selection = editor.selection;
  if (!selection.isEmpty) {
    editor.setDecorations(bracketDecoration, []);
    lastDecoratedEditor = editor;
    return;
  }

  const activeOffset = editor.document.offsetAt(selection.active);
  const token = findBracketAtCursor(visibleContext.tokens, activeOffset);
  const match = token === undefined ? undefined : findMatchingBracket(visibleContext.tokens, token);

  if (!token || !match) {
    editor.setDecorations(bracketDecoration, []);
    lastDecoratedEditor = editor;
    return;
  }

  editor.setDecorations(bracketDecoration, [
    toTokenRange(editor.document, token),
    toTokenRange(editor.document, match)
  ]);
  lastDecoratedEditor = editor;
}

function analyzeVisibleRanges(editor: vscode.TextEditor): {
  tokens: BracketToken[];
  diagnostics: vscode.Diagnostic[];
} {
  const tokens: BracketToken[] = [];
  const diagnostics: vscode.Diagnostic[] = [];

  for (const range of normalizeRanges(editor.visibleRanges)) {
    const rangeTokens = tokenizeRange(editor.document, range);
    tokens.push(...rangeTokens);
    diagnostics.push(...buildDiagnostics(editor.document, range, rangeTokens));
  }

  return { tokens, diagnostics };
}

function normalizeRanges(ranges: readonly vscode.Range[]): vscode.Range[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((left, right) => left.start.compareTo(right.start));
  const merged: vscode.Range[] = [];

  for (const range of sorted) {
    const previous = merged.length === 0 ? undefined : merged[merged.length - 1];

    if (!previous || previous.end.isBefore(range.start)) {
      merged.push(range);
      continue;
    }

    const end = previous.end.isAfter(range.end) ? previous.end : range.end;
    merged[merged.length - 1] = new vscode.Range(previous.start, end);
  }

  return merged;
}

function tokenizeRange(document: vscode.TextDocument, range: vscode.Range): BracketToken[] {
  const scanStart = document.positionAt(Math.max(0, document.offsetAt(range.start) - BYTEVECTOR_PREFIX.length));
  const scanRange = new vscode.Range(scanStart, range.end);
  const text = document.getText(scanRange);
  const baseOffset = document.offsetAt(scanRange.start);
  const visibleStartOffset = document.offsetAt(range.start);
  const visibleEndOffset = document.offsetAt(range.end);
  const tokens: BracketToken[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const escapeLength = getEscapedSequenceLength(text, index);
    if (escapeLength > 0) {
      index += escapeLength - 1;
      continue;
    }

    const vectorLength = getVectorPrefixLength(text, index);
    if (vectorLength > 0) {
      const token = {
        offset: baseOffset + index,
        length: vectorLength,
        kind: "open",
        type: "vector"
      } satisfies BracketToken;

      if (intersectsVisibleRange(token, visibleStartOffset, visibleEndOffset)) {
        tokens.push(token);
      }
      index += vectorLength - 1;
      continue;
    }

    const char = text[index];
    if (char === OPEN_PAREN) {
      const token = {
        offset: baseOffset + index,
        length: 1,
        kind: "open",
        type: "list"
      } satisfies BracketToken;

      if (intersectsVisibleRange(token, visibleStartOffset, visibleEndOffset)) {
        tokens.push(token);
      }
      continue;
    }

    if (char === CLOSE_PAREN) {
      const token = {
        offset: baseOffset + index,
        length: 1,
        kind: "close",
        type: "list"
      } satisfies BracketToken;

      if (intersectsVisibleRange(token, visibleStartOffset, visibleEndOffset)) {
        tokens.push(token);
      }
    }
  }

  return tokens;
}

function getEscapedSequenceLength(text: string, index: number): number {
  return text.startsWith(`${ESCAPE_PREFIX}${VECTOR_PREFIX}`, index) || text.startsWith(`${ESCAPE_PREFIX}#)`, index)
    ? 3
    : 0;
}

function getVectorPrefixLength(text: string, index: number): number {
  if (text.startsWith(BYTEVECTOR_PREFIX, index)) {
    return BYTEVECTOR_PREFIX.length;
  }

  if (text.startsWith(VECTOR_PREFIX, index)) {
    return VECTOR_PREFIX.length;
  }

  return 0;
}

function intersectsVisibleRange(token: BracketToken, startOffset: number, endOffset: number): boolean {
  return token.offset < endOffset && token.offset + token.length > startOffset;
}

function buildDiagnostics(
  document: vscode.TextDocument,
  visibleRange: vscode.Range,
  tokens: readonly BracketToken[]
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const stack: BracketToken[] = [];
  const visibleStartOffset = document.offsetAt(visibleRange.start);
  const visibleEndOffset = document.offsetAt(visibleRange.end);
  const canConfirmLeadingMismatch = visibleStartOffset === 0;
  const canConfirmTrailingMismatch = visibleEndOffset === document.getText().length;

  for (const token of tokens) {
    if (token.kind === "open") {
      stack.push(token);
      continue;
    }

    const openToken = stack.pop();
    if (!openToken) {
      if (canConfirmLeadingMismatch) {
        diagnostics.push(createDiagnostic(document, token, "Unmatched closing parenthesis"));
      }
    }
  }

  if (canConfirmTrailingMismatch) {
    for (const token of stack) {
      diagnostics.push(createDiagnostic(document, token, token.type === "vector" ? "Unmatched vector opener #(" : "Unmatched opening parenthesis"));
    }
  }

  return diagnostics;
}

function createDiagnostic(
  document: vscode.TextDocument,
  token: BracketToken,
  message: string
): vscode.Diagnostic {
  return new vscode.Diagnostic(
    toTokenRange(document, token),
    message,
    vscode.DiagnosticSeverity.Error
  );
}

function findBracketAtCursor(tokens: readonly BracketToken[], activeOffset: number): BracketToken | undefined {
  const offsetsToCheck = [activeOffset, activeOffset - 1];

  for (const offset of offsetsToCheck) {
    if (offset < 0) {
      continue;
    }

    const token = tokens.find((candidate) => offset >= candidate.offset && offset < candidate.offset + candidate.length);
    if (token) {
      return token;
    }
  }

  return undefined;
}

function findMatchingBracket(tokens: readonly BracketToken[], token: BracketToken): BracketToken | undefined {
  const tokenIndex = tokens.findIndex((candidate) => candidate.offset === token.offset && candidate.kind === token.kind);

  if (tokenIndex < 0) {
    return undefined;
  }

  return token.kind === "open"
    ? scanForward(tokens, tokenIndex + 1)
    : scanBackward(tokens, tokenIndex - 1);
}

function scanForward(tokens: readonly BracketToken[], startIndex: number): BracketToken | undefined {
  let depth = 1;

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    depth += token.kind === "open" ? 1 : -1;

    if (depth === 0) {
      return token;
    }
  }

  return undefined;
}

function scanBackward(tokens: readonly BracketToken[], startIndex: number): BracketToken | undefined {
  let depth = 1;

  for (let index = startIndex; index >= 0; index -= 1) {
    const token = tokens[index];
    depth += token.kind === "close" ? 1 : -1;

    if (depth === 0) {
      return token;
    }
  }

  return undefined;
}

function toTokenRange(document: vscode.TextDocument, token: BracketToken): vscode.Range {
  const start = document.positionAt(token.offset);
  const end = document.positionAt(token.offset + token.length);

  return new vscode.Range(start, end);
}

function isDiagnosticsEnabled(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>("enableDiagnostics", true);
}

function getDebounceDelay(): number {
  const configuredDelay = vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>("debounceMs", DEFAULT_DEBOUNCE_MS);

  return typeof configuredDelay === "number" && configuredDelay >= 0
    ? configuredDelay
    : DEFAULT_DEBOUNCE_MS;
}
