import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, isAbsolute, join, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'

export type PdfPlatform = 'linux' | 'darwin' | 'win32'
export type PdfPaperSize = 'A4' | 'Letter' | 'Legal'
export type PdfMargins = 'default' | 'none' | 'narrow' | 'wide'

const BROWSERS: Record<PdfPlatform, string[]> = {
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable'],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  win32: ['Google/Chrome/Application/chrome.exe', 'Chromium/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'],
}

export function executablePath(name: string, platform: PdfPlatform, env: NodeJS.ProcessEnv = process.env, canRun = isExecutable): string | undefined {
  if (isAbsolute(name) || (platform === 'win32' && win32.isAbsolute(name))) return canRun(name) ? name : undefined
  if (name.includes('/') || name.includes('\\')) return undefined
  const pathDirs = (env.PATH ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean)
  const suffixes = platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? ['', '.exe'] : ['']
  for (const dir of pathDirs) {
    for (const suffix of suffixes) {
      const candidate = platform === 'win32' ? win32.join(dir, name + suffix) : join(dir, name + suffix)
      if (canRun(candidate)) return candidate
    }
  }
  return undefined
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function findBrowser(platform: PdfPlatform, env: NodeJS.ProcessEnv = process.env, canRun = isExecutable, configured = ''): string | undefined {
  if (configured.trim()) return executablePath(configured.trim(), platform, env, canRun)
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((root): root is string => Boolean(root))
    for (const root of roots) {
      for (const relative of BROWSERS.win32) {
        const candidate = win32.join(root, ...relative.split('/'))
        if (canRun(candidate)) return candidate
      }
    }
  } else if (platform === 'darwin') {
    for (const candidate of BROWSERS.darwin) if (canRun(candidate)) return candidate
  } else {
    for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge']) {
      if (canRun(candidate)) return candidate
    }
  }
  for (const name of platform === 'darwin' ? ['google-chrome', 'chromium', 'microsoft-edge'] : platform === 'win32' ? ['chrome', 'chromium', 'msedge'] : BROWSERS.linux) {
    const found = executablePath(name, platform, env, canRun)
    if (found) return found
  }
  return undefined
}

export function pdfPrintHtml(html: string, paperSize: PdfPaperSize, margins: PdfMargins): string {
  const margin = { default: '20mm', none: '0', narrow: '10mm', wide: '30mm' }[margins]
  const style = `<style>@page { size: ${paperSize}; margin: ${margin}; }</style>`
  return html.replace('</head>', `${style}</head>`)
}

export function browserPdfArgs(inputHtml: string, outputPdf: string): string[] {
  return ['--headless', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer', `--print-to-pdf=${outputPdf}`, pathToFileURL(inputHtml).href]
}

export function crv2pdfArgs(inputCrv: string, outputPdf: string): string[] {
  return [inputCrv, outputPdf, '--pdf']
}

export const MISSING_PDF_TOOL_MESSAGE = 'PDF export needs crv2pdf (install markup-carve/carve-pdf and add crv2pdf to PATH, or set carve.pdf.crv2pdfPath) or an installed Chrome, Chromium, or Edge browser (or set carve.pdf.browserPath).'

export async function runPdfTool(command: string, args: string[], output: string, timeoutMs = 120_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true })
    let stderr = ''
    let settled = false
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8000) })
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    child.on('error', (error) => finish(new Error(`${command}: ${error.message}`)))
    child.on('close', (code, signal) => {
      if (code === 0 && existsSync(output)) finish()
      else finish(new Error(`${command} failed${timedOut ? ` (timeout after ${timeoutMs} ms)` : signal ? ` (${signal})` : ` (exit ${code})`}${stderr ? `: ${stderr.trim()}` : ''}${code === 0 ? ': PDF was not created' : ''}`))
    })
  })
}
