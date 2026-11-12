const assert = require('node:assert/strict')
const path = require('node:path')
const vscode = require('vscode')

async function check() {
  const extension = vscode.extensions.getExtension('markup-carve.vscode-carve')
  assert.ok(extension, 'the extension under test is installed')
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath
  const document = await vscode.workspace.openTextDocument(path.join(folder, 'sample.crv'))
  await vscode.window.showTextDocument(document)
  // Rejects with the activation error, e.g. "command 'carve.exportPdf' already exists".
  await extension.activate()
  assert.ok(extension.isActive, 'the extension is active')

  const commands = await vscode.commands.getCommands(true)
  assert.ok(commands.includes('carve.exportPdf'), 'carve.exportPdf is registered')
  assert.ok(commands.includes('carve.listIndent'), 'the language server commands are registered')

  // The shape of carve-lsp's "Export as PDF" code action command: the id plus
  // the document uri. An untitled document stops at the "open a local
  // document" warning, so the command runs to the end without a save dialog.
  const untitled = await vscode.workspace.openTextDocument({ language: 'carve', content: '# Draft\n' })
  await vscode.commands.executeCommand('carve.exportPdf', untitled.uri.toString())
}

module.exports = {
  run: () => check().then(() => console.log('activation test passed')),
}
