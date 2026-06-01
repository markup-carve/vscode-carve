import { carveToHtml } from '@markup-carve/carve'

export function renderPreviewBody(source: string): string {
  return carveToHtml(source)
}

export function previewDocument(source: string, nonce: string): string {
  const body = renderPreviewBody(source)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    body {
      margin: 0;
      padding: 24px;
      line-height: 1.55;
    }
    main {
      max-width: 760px;
      margin: 0 auto;
    }
    pre, code {
      font-family: var(--vscode-editor-font-family);
    }
    pre {
      overflow-x: auto;
      padding: 12px;
      background: var(--vscode-textCodeBlock-background);
    }
    table {
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid var(--vscode-panel-border);
      padding: 4px 8px;
    }
    blockquote {
      margin-left: 0;
      padding-left: 16px;
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      color: var(--vscode-textBlockQuote-foreground);
    }
  </style>
  <title>Carve Preview</title>
</head>
<body>
  <main>${body}</main>
</body>
</html>`
}
