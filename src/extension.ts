import * as vscode from "vscode";

const SUPPORTED_LANGUAGES = new Set(["scheme", "racket", "lisp"]);
const OPEN_PAREN = "(";
const CLOSE_PAREN = ")";
const VECTOR_PREFIX = "#(";
const BYTEVECTOR_PREFIX = "#vu8(";

const CONFIG_SECTION = "lispBracketMatcher";
const DEFAULT_DEBOUNCE_MS = 120;

// Bracket match colors - using high-contrast colors for better visibility
// These colors are similar to VS Code's default bracket match colors
const FALLBACK_COLORS = {
  background: "rgba(128, 128, 128, 0.3)",
  border: "rgba(192, 192, 192, 0.8)"
};

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
  console.log("[Lisp Bracket Matcher] Activating extension...");
  console.log("[Lisp Bracket Matcher] Supported languages:", Array.from(SUPPORTED_LANGUAGES));

  try {
    // Create decoration type with explicit colors for better visibility
    // Using rgba colors directly instead of ThemeColor to avoid theme compatibility issues
    bracketDecoration = vscode.window.createTextEditorDecorationType({
      borderRadius: "3px",
      backgroundColor: FALLBACK_COLORS.background,
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: FALLBACK_COLORS.border,
      overviewRulerColor: FALLBACK_COLORS.border,
      overviewRulerLane: vscode.OverviewRulerLane.Center
    });

    diagnosticCollection = vscode.languages.createDiagnosticCollection("lisp-bracket-matcher");

    context.subscriptions.push(bracketDecoration, diagnosticCollection);

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        console.log("[Lisp Bracket Matcher] Active editor changed:", editor?.document.languageId);
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

    console.log("[Lisp Bracket Matcher] Extension activated successfully");
    scheduleEditorUpdate(vscode.window.activeTextEditor, 0);
  } catch (error) {
    console.error("[Lisp Bracket Matcher] Activation failed:", error);
    throw error;
  }
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

  if (!editor) {
    console.log("[Lisp Bracket Matcher] No active editor");
    lastDecoratedEditor = editor;
    return;
  }

  // Debug: Log language ID check
  const languageId = editor.document.languageId;
  console.log(`[Lisp Bracket Matcher] Checking language ID: "${languageId}"`);
  console.log(`[Lisp Bracket Matcher] Supported: ${SUPPORTED_LANGUAGES.has(languageId)}`);

  if (!bracketDecoration || !diagnosticCollection || !SUPPORTED_LANGUAGES.has(languageId)) {
    if (bracketDecoration) {
      editor.setDecorations(bracketDecoration, []);
    }
    diagnosticCollection?.delete(editor.document.uri);

    // Provide clear feedback when language is not supported
    if (!SUPPORTED_LANGUAGES.has(languageId)) {
      console.log(`[Lisp Bracket Matcher] Language "${languageId}" not supported. Supported: ${Array.from(SUPPORTED_LANGUAGES).join(", ")}`);
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
    console.log(`[Lisp Bracket Matcher] Selection not empty, clearing decorations`);
    editor.setDecorations(bracketDecoration, []);
    lastDecoratedEditor = editor;
    return;
  }

  const activeOffset = editor.document.offsetAt(selection.active);
  console.log(`[Lisp Bracket Matcher] Active offset: ${activeOffset}`);
  console.log(`[Lisp Bracket Matcher] Total tokens from visible ranges: ${visibleContext.tokens.length}`);

  // Always use full document tokens for bracket matching to avoid issues when scrolling
  const fullDocRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(editor.document.getText().length)
  );
  const allTokens = tokenizeRange(editor.document, fullDocRange);
  console.log(`[Lisp Bracket Matcher] Total tokens in document: ${allTokens.length}`);

  const token = findBracketAtCursor(allTokens, activeOffset);
  console.log(`[Lisp Bracket Matcher] Token found:`, token ? JSON.stringify(token) : 'undefined');

  const match = token === undefined ? undefined : findMatchingBracket(allTokens, token);
  console.log(`[Lisp Bracket Matcher] Match found:`, match ? JSON.stringify(match) : 'undefined');

  if (!token || !match) {
    console.log(`[Lisp Bracket Matcher] No token or match, clearing decorations. token=${!!token}, match=${!!match}`);
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
  const rangeStartOffset = document.offsetAt(range.start);
  const rangeEndOffset = document.offsetAt(range.end);
  const scanStartOffset = Math.max(0, rangeStartOffset - BYTEVECTOR_PREFIX.length);
  const scanStart = document.positionAt(scanStartOffset);
  const scanRange = new vscode.Range(scanStart, range.end);
  const text = document.getText(scanRange);
  const baseOffset = document.offsetAt(scanRange.start);
  const visibleStartOffset = rangeStartOffset;
  const visibleEndOffset = rangeEndOffset;
  const tokens: BracketToken[] = [];

  console.log(`[Lisp Bracket Matcher] tokenizeRange: rangeStartOffset=${rangeStartOffset}, rangeEndOffset=${rangeEndOffset}`);
  console.log(`[Lisp Bracket Matcher] tokenizeRange: scanStartOffset=${scanStartOffset}, baseOffset=${baseOffset}`);
  console.log(`[Lisp Bracket Matcher] tokenizeRange: visibleStartOffset=${visibleStartOffset}, visibleEndOffset=${visibleEndOffset}`);
  console.log(`[Lisp Bracket Matcher] tokenizeRange: text length=${text.length}`);

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
  // Handle character literals: #\( and #\) and #\space, #\newline, etc.
  // Character literal syntax is #\X where X can be any character or named character
  if (text.startsWith('#\\', index)) {
    // We're at the start of a character literal
    // Character literal is at minimum #\X (3 characters)
    if (index + 2 < text.length) {
      const charAfterBackslash = text[index + 2];
      
      // Check if it's a single-character literal like #\( or #\)
      // These are always 3 characters: #, \, and the character
      if (charAfterBackslash === '(' || charAfterBackslash === ')' || 
          charAfterBackslash === '[' || charAfterBackslash === ']' ||
          charAfterBackslash === '{' || charAfterBackslash === '}' ||
          charAfterBackslash === '"' || charAfterBackslash === ';' ||
          charAfterBackslash === ' ' || charAfterBackslash === '\t' ||
          charAfterBackslash === '\n' || charAfterBackslash === '\r' ||
          charAfterBackslash === '\\') {
        return 3; // #\X where X is a special character
      }
      
      // Otherwise, it might be a named character like #\space or #\newline
      // Consume until we hit a delimiter
      let len = 3; // Start with #\X (at least one character after \)
      while (index + len < text.length) {
        const ch = text[index + len];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || 
            ch === '(' || ch === ')' || ch === '[' || ch === ']' || 
            ch === '{' || ch === '}' || ch === '"' || ch === ';') {
          break;
        }
        len++;
      }
      
      return len;
    }
    
    // Edge case: #\ at end of text
    return 2;
  }
  
  return 0;
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
  const result = token.offset < endOffset && token.offset + token.length > startOffset;
  // console.log(`[Lisp Bracket Matcher] intersectsVisibleRange: token.offset=${token.offset}, token.length=${token.length}, startOffset=${startOffset}, endOffset=${endOffset}, result=${result}`);
  return result;
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
  console.log(`[Lisp Bracket Matcher] findBracketAtCursor: activeOffset=${activeOffset}, tokens count=${tokens.length}`);
  console.log(`[Lisp Bracket Matcher] Tokens:`, JSON.stringify(tokens));

  const offsetsToCheck = [activeOffset, activeOffset - 1];

  for (const offset of offsetsToCheck) {
    if (offset < 0) {
      continue;
    }

    const token = tokens.find((candidate) => offset >= candidate.offset && offset < candidate.offset + candidate.length);
    console.log(`[Lisp Bracket Matcher] Checking offset=${offset}, found token:`, token ? JSON.stringify(token) : 'undefined');
    if (token) {
      return token;
    }
  }

  return undefined;
}

function findMatchingBracket(tokens: readonly BracketToken[], token: BracketToken): BracketToken | undefined {
  console.log(`[Lisp Bracket Matcher] findMatchingBracket: looking for token=`, JSON.stringify(token));
  console.log(`[Lisp Bracket Matcher] tokens count=${tokens.length}, tokens=`, JSON.stringify(tokens));

  const tokenIndex = tokens.findIndex((candidate) => candidate.offset === token.offset && candidate.kind === token.kind);

  console.log(`[Lisp Bracket Matcher] tokenIndex=${tokenIndex}`);

  if (tokenIndex < 0) {
    console.log(`[Lisp Bracket Matcher] Token not found in tokens array! Trying direct search...`);
    // Even if token is not in the array (e.g., at edge of visible range), try to find match
    // by searching for a token with matching offset and kind
    const directMatch = tokens.find((candidate) => candidate.offset === token.offset && candidate.kind === token.kind);
    if (directMatch) {
      const foundIndex = tokens.indexOf(directMatch);
      console.log(`[Lisp Bracket Matcher] Found direct match at index=${foundIndex}`);
      return token.kind === "open"
        ? scanForward(tokens, foundIndex + 1)
        : scanBackward(tokens, foundIndex - 1);
    }
    console.log(`[Lisp Bracket Matcher] No direct match found, returning undefined`);
    return undefined;
  }

  const result = token.kind === "open"
    ? scanForward(tokens, tokenIndex + 1)
    : scanBackward(tokens, tokenIndex - 1);

  console.log(`[Lisp Bracket Matcher] Matching result:`, result ? JSON.stringify(result) : 'undefined');
  return result;
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
