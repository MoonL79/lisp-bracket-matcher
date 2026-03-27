"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const SUPPORTED_LANGUAGES = new Set(["scheme", "racket", "lisp"]);
const OPEN_PAREN = "(";
const CLOSE_PAREN = ")";
const VECTOR_PREFIX = "#(";
const BYTEVECTOR_PREFIX = "#vu8(";
const ESCAPE_PREFIX = "\\";
const CONFIG_SECTION = "lispBracketMatcher";
const DEFAULT_DEBOUNCE_MS = 120;
// Fallback colors for cross-platform compatibility
const FALLBACK_COLORS = {
    background: "rgba(128, 128, 128, 0.2)",
    border: "rgba(128, 128, 128, 0.5)"
};
let bracketDecoration;
let diagnosticCollection;
let lastDecoratedEditor;
let pendingUpdate;
let pendingEditor;
function activate(context) {
    console.log("[Lisp Bracket Matcher] Activating extension...");
    console.log("[Lisp Bracket Matcher] Supported languages:", Array.from(SUPPORTED_LANGUAGES));
    try {
        // Create decoration type with fallback colors for cross-platform compatibility
        const backgroundColor = new vscode.ThemeColor("editorBracketMatch.background");
        const borderColor = new vscode.ThemeColor("editorBracketMatch.border");
        bracketDecoration = vscode.window.createTextEditorDecorationType({
            borderRadius: "3px",
            backgroundColor: backgroundColor,
            border: "1px solid",
            borderColor: borderColor,
            // Fallback colors using light/dark theme detection
            light: {
                backgroundColor: FALLBACK_COLORS.background,
                borderColor: FALLBACK_COLORS.border
            },
            dark: {
                backgroundColor: FALLBACK_COLORS.background,
                borderColor: FALLBACK_COLORS.border
            }
        });
        diagnosticCollection = vscode.languages.createDiagnosticCollection("lisp-bracket-matcher");
        context.subscriptions.push(bracketDecoration, diagnosticCollection);
        context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
            console.log("[Lisp Bracket Matcher] Active editor changed:", editor?.document.languageId);
            scheduleEditorUpdate(editor, 0);
        }), vscode.window.onDidChangeTextEditorSelection((event) => {
            scheduleEditorUpdate(event.textEditor, 0);
        }), vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
            scheduleEditorUpdate(event.textEditor, 0);
        }), vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                scheduleEditorUpdate(editor);
            }
        }), vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(CONFIG_SECTION)) {
                scheduleEditorUpdate(vscode.window.activeTextEditor, 0);
            }
        }), vscode.workspace.onDidCloseTextDocument((document) => {
            diagnosticCollection?.delete(document.uri);
        }));
        console.log("[Lisp Bracket Matcher] Extension activated successfully");
        scheduleEditorUpdate(vscode.window.activeTextEditor, 0);
    }
    catch (error) {
        console.error("[Lisp Bracket Matcher] Activation failed:", error);
        throw error;
    }
}
function deactivate() {
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
function scheduleEditorUpdate(editor, delay = getDebounceDelay()) {
    pendingEditor = editor;
    if (pendingUpdate) {
        clearTimeout(pendingUpdate);
    }
    pendingUpdate = setTimeout(() => {
        pendingUpdate = undefined;
        updateEditorState(pendingEditor);
    }, delay);
}
function updateEditorState(editor) {
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
    }
    else {
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
function analyzeVisibleRanges(editor) {
    const tokens = [];
    const diagnostics = [];
    for (const range of normalizeRanges(editor.visibleRanges)) {
        const rangeTokens = tokenizeRange(editor.document, range);
        tokens.push(...rangeTokens);
        diagnostics.push(...buildDiagnostics(editor.document, range, rangeTokens));
    }
    return { tokens, diagnostics };
}
function normalizeRanges(ranges) {
    if (ranges.length === 0) {
        return [];
    }
    const sorted = [...ranges].sort((left, right) => left.start.compareTo(right.start));
    const merged = [];
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
function tokenizeRange(document, range) {
    const scanStart = document.positionAt(Math.max(0, document.offsetAt(range.start) - BYTEVECTOR_PREFIX.length));
    const scanRange = new vscode.Range(scanStart, range.end);
    const text = document.getText(scanRange);
    const baseOffset = document.offsetAt(scanRange.start);
    const visibleStartOffset = document.offsetAt(range.start);
    const visibleEndOffset = document.offsetAt(range.end);
    const tokens = [];
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
            };
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
            };
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
            };
            if (intersectsVisibleRange(token, visibleStartOffset, visibleEndOffset)) {
                tokens.push(token);
            }
        }
    }
    return tokens;
}
function getEscapedSequenceLength(text, index) {
    return text.startsWith(`${ESCAPE_PREFIX}${VECTOR_PREFIX}`, index) || text.startsWith(`${ESCAPE_PREFIX}#)`, index)
        ? 3
        : 0;
}
function getVectorPrefixLength(text, index) {
    if (text.startsWith(BYTEVECTOR_PREFIX, index)) {
        return BYTEVECTOR_PREFIX.length;
    }
    if (text.startsWith(VECTOR_PREFIX, index)) {
        return VECTOR_PREFIX.length;
    }
    return 0;
}
function intersectsVisibleRange(token, startOffset, endOffset) {
    return token.offset < endOffset && token.offset + token.length > startOffset;
}
function buildDiagnostics(document, visibleRange, tokens) {
    const diagnostics = [];
    const stack = [];
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
function createDiagnostic(document, token, message) {
    return new vscode.Diagnostic(toTokenRange(document, token), message, vscode.DiagnosticSeverity.Error);
}
function findBracketAtCursor(tokens, activeOffset) {
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
function findMatchingBracket(tokens, token) {
    const tokenIndex = tokens.findIndex((candidate) => candidate.offset === token.offset && candidate.kind === token.kind);
    if (tokenIndex < 0) {
        return undefined;
    }
    return token.kind === "open"
        ? scanForward(tokens, tokenIndex + 1)
        : scanBackward(tokens, tokenIndex - 1);
}
function scanForward(tokens, startIndex) {
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
function scanBackward(tokens, startIndex) {
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
function toTokenRange(document, token) {
    const start = document.positionAt(token.offset);
    const end = document.positionAt(token.offset + token.length);
    return new vscode.Range(start, end);
}
function isDiagnosticsEnabled() {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get("enableDiagnostics", true);
}
function getDebounceDelay() {
    const configuredDelay = vscode.workspace.getConfiguration(CONFIG_SECTION).get("debounceMs", DEFAULT_DEBOUNCE_MS);
    return typeof configuredDelay === "number" && configuredDelay >= 0
        ? configuredDelay
        : DEFAULT_DEBOUNCE_MS;
}
//# sourceMappingURL=extension.js.map