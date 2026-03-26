import * as vscode from "vscode";

const SUPPORTED_LANGUAGES = new Set(["scheme", "racket", "lisp"]);
const OPEN_PAREN = "(";
const CLOSE_PAREN = ")";
const VECTOR_PREFIX = "#";
const ESCAPE_PREFIX = "\\";

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

export function activate(context: vscode.ExtensionContext): void {
  bracketDecoration = vscode.window.createTextEditorDecorationType({
    borderRadius: "3px",
    backgroundColor: new vscode.ThemeColor("editorBracketMatch.background"),
    border: "1px solid",
    borderColor: new vscode.ThemeColor("editorBracketMatch.border"),
    color: new vscode.ThemeColor("editorBracketMatch.foreground")
  });
  diagnosticCollection = vscode.languages.createDiagnosticCollection("lisp-bracket-matcher");

  context.subscriptions.push(bracketDecoration, diagnosticCollection);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateEditorState(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      updateEditorState(event.textEditor);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      updateEditorState(event.textEditor);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;

      if (editor && event.document === editor.document) {
        updateEditorState(editor);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticCollection?.delete(document.uri);
    })
  );

  updateEditorState(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  if (bracketDecoration) {
    bracketDecoration.dispose();
    bracketDecoration = undefined;
  }

  if (diagnosticCollection) {
    diagnosticCollection.dispose();
    diagnosticCollection = undefined;
  }
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
  diagnosticCollection.set(editor.document.uri, visibleContext.diagnostics);

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

  for (const range of normalizeRanges(editor.visibleRanges)) {
    tokens.push(...tokenizeRange(editor.document, range));
  }

  const diagnostics = buildDiagnostics(editor.document, tokens);

  return { tokens, diagnostics };
}

function normalizeRanges(ranges: readonly vscode.Range[]): vscode.Range[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((left, right) => left.start.compareTo(right.start));
  const merged: vscode.Range[] = [];

  for (const range of sorted) {
    const previous = merged.at(-1);

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
  const text = document.getText(range);
  const baseOffset = document.offsetAt(range.start);
  const tokens: BracketToken[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === OPEN_PAREN) {
      if (isEscapedParen(text, index)) {
        continue;
      }

      if (text[index - 1] === VECTOR_PREFIX) {
        tokens.push({
          offset: baseOffset + index - 1,
          length: 2,
          kind: "open",
          type: "vector"
        });
        continue;
      }

      tokens.push({
        offset: baseOffset + index,
        length: 1,
        kind: "open",
        type: "list"
      });
      continue;
    }

    if (char === CLOSE_PAREN && !isEscapedParen(text, index)) {
      tokens.push({
        offset: baseOffset + index,
        length: 1,
        kind: "close",
        type: "list"
      });
    }
  }

  return tokens;
}

function isEscapedParen(text: string, index: number): boolean {
  return text[index - 1] === VECTOR_PREFIX && text[index - 2] === ESCAPE_PREFIX;
}

function buildDiagnostics(document: vscode.TextDocument, tokens: readonly BracketToken[]): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const stack: BracketToken[] = [];

  for (const token of tokens) {
    if (token.kind === "open") {
      stack.push(token);
      continue;
    }

    const openToken = stack.pop();
    if (!openToken) {
      diagnostics.push(createDiagnostic(document, token, "Unmatched closing parenthesis"));
    }
  }

  for (const token of stack) {
    diagnostics.push(createDiagnostic(document, token, token.type === "vector" ? "Unmatched vector opener #(" : "Unmatched opening parenthesis"));
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
