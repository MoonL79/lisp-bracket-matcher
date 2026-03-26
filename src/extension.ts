import * as vscode from "vscode";

const SUPPORTED_LANGUAGES = new Set(["scheme", "racket", "lisp"]);
const OPEN_PAREN = "(";
const CLOSE_PAREN = ")";

let bracketDecoration: vscode.TextEditorDecorationType | undefined;
let lastDecoratedEditor: vscode.TextEditor | undefined;

export function activate(context: vscode.ExtensionContext): void {
  bracketDecoration = vscode.window.createTextEditorDecorationType({
    borderRadius: "3px",
    backgroundColor: new vscode.ThemeColor("editorBracketMatch.background"),
    border: "1px solid",
    borderColor: new vscode.ThemeColor("editorBracketMatch.border"),
    color: new vscode.ThemeColor("editorBracketMatch.foreground")
  });

  context.subscriptions.push(bracketDecoration);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateDecorations(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      updateDecorations(event.textEditor);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;

      if (editor && event.document === editor.document) {
        updateDecorations(editor);
      }
    })
  );

  updateDecorations(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  if (bracketDecoration) {
    bracketDecoration.dispose();
    bracketDecoration = undefined;
  }
}

function updateDecorations(editor: vscode.TextEditor | undefined): void {
  if (lastDecoratedEditor && lastDecoratedEditor !== editor && bracketDecoration) {
    lastDecoratedEditor.setDecorations(bracketDecoration, []);
  }

  if (!editor || !bracketDecoration || !SUPPORTED_LANGUAGES.has(editor.document.languageId)) {
    if (editor && bracketDecoration) {
      editor.setDecorations(bracketDecoration, []);
    }
    lastDecoratedEditor = editor;
    return;
  }

  const selection = editor.selection;

  if (!selection.isEmpty) {
    editor.setDecorations(bracketDecoration, []);
    lastDecoratedEditor = editor;
    return;
  }

  const text = editor.document.getText();
  const activeOffset = editor.document.offsetAt(selection.active);
  const bracketOffset = findBracketAtCursor(text, activeOffset);
  const match = bracketOffset === undefined ? undefined : findMatchingBracket(text, bracketOffset);

  if (!match) {
    editor.setDecorations(bracketDecoration, []);
    lastDecoratedEditor = editor;
    return;
  }

  const ranges = [
    toSingleCharacterRange(editor.document, bracketOffset),
    toSingleCharacterRange(editor.document, match)
  ];

  editor.setDecorations(bracketDecoration, ranges);
  lastDecoratedEditor = editor;
}

function findBracketAtCursor(text: string, activeOffset: number): number | undefined {
  const offsetsToCheck = [activeOffset, activeOffset - 1];

  for (const offset of offsetsToCheck) {
    if (offset < 0 || offset >= text.length) {
      continue;
    }

    const char = text[offset];
    if ((char === OPEN_PAREN || char === CLOSE_PAREN) && !isIgnoredParen(text, offset)) {
      return offset;
    }
  }

  return undefined;
}

function findMatchingBracket(text: string, bracketOffset: number): number | undefined {
  const bracket = text[bracketOffset];

  if (bracket === OPEN_PAREN) {
    return scanForward(text, bracketOffset + 1);
  }

  if (bracket === CLOSE_PAREN) {
    return scanBackward(text, bracketOffset - 1);
  }

  return undefined;
}

function scanForward(text: string, startOffset: number): number | undefined {
  let depth = 1;

  for (let offset = startOffset; offset < text.length; offset += 1) {
    const char = text[offset];

    if ((char !== OPEN_PAREN && char !== CLOSE_PAREN) || isIgnoredParen(text, offset)) {
      continue;
    }

    depth += char === OPEN_PAREN ? 1 : -1;

    if (depth === 0) {
      return offset;
    }
  }

  return undefined;
}

function scanBackward(text: string, startOffset: number): number | undefined {
  let depth = 1;

  for (let offset = startOffset; offset >= 0; offset -= 1) {
    const char = text[offset];

    if ((char !== OPEN_PAREN && char !== CLOSE_PAREN) || isIgnoredParen(text, offset)) {
      continue;
    }

    depth += char === CLOSE_PAREN ? 1 : -1;

    if (depth === 0) {
      return offset;
    }
  }

  return undefined;
}

function isIgnoredParen(text: string, offset: number): boolean {
  const char = text[offset];

  if (char !== OPEN_PAREN && char !== CLOSE_PAREN) {
    return false;
  }

  return text[offset - 1] === "#" && text[offset - 2] === "\\";
}

function toSingleCharacterRange(document: vscode.TextDocument, offset: number): vscode.Range {
  const start = document.positionAt(offset);
  const end = document.positionAt(offset + 1);

  return new vscode.Range(start, end);
}
