/**
 * The client half of the include contract in PART 9 §19.
 *
 * The language server already implements include resolution end to end -
 * containment, cycle and depth guards, diagnostics, go-to-definition, path
 * completion, and a watcher over every target it resolved OR merely attempted.
 * None of it engages unless the client says two things in
 * `initializationOptions`: the `carve.includes` settings, and whether the
 * workspace is trusted. §19 makes the capability opt-in, and the server reads
 * silence as "no": an extension that sends neither gets a server that leaves
 * every directive literal.
 *
 * Kept free of `vscode` imports so the payload is testable on its own against
 * the installed server's own gate, which is the only check that cannot lie
 * about whether the wiring reaches it.
 */

/** Values the server accepts for the include gate. `auto` is on when trusted. */
export const INCLUDE_ENABLED_VALUES = ['auto', 'on', 'off'] as const

export type IncludeEnabled = (typeof INCLUDE_ENABLED_VALUES)[number]

/** `carve.includes.*` as VS Code hands it back, before validation. */
export interface IncludeConfiguration {
  enabled?: unknown
  includeRoot?: unknown
  allowAbsolute?: unknown
}

export interface IncludeSettingsPayload {
  enabled: IncludeEnabled
  includeRoot?: string
  allowAbsolute?: boolean
}

export interface InitializationOptionsInput {
  formatter: string
  includes: IncludeConfiguration
  workspaceTrusted: boolean
}

export interface CarveInitializationOptions {
  carve: {
    formatter: string
    includes: IncludeSettingsPayload
    /** Off: the extension's own export commands already cover the server's export source actions. */
    exportActions: false
  }
  /**
   * TOP LEVEL, not under `carve`. `readWorkspaceTrusted` reads
   * `initializationOptions.workspaceTrusted`, so nesting it turns the whole
   * feature off with no error anywhere: `enabled: "auto"` plus an untrusted
   * workspace is a legitimate quiet state.
   */
  workspaceTrusted: boolean
}

export function includeEnabledFrom(raw: unknown): IncludeEnabled {
  return INCLUDE_ENABLED_VALUES.includes(raw as IncludeEnabled) ? (raw as IncludeEnabled) : 'auto'
}

export function includeSettingsPayload(config: IncludeConfiguration): IncludeSettingsPayload {
  const payload: IncludeSettingsPayload = { enabled: includeEnabledFrom(config.enabled) }
  // An UNSET string setting comes back from VS Code as "", and `realpathSync("")`
  // resolves to the PROCESS WORKING DIRECTORY - measured, not assumed. A server
  // is commonly spawned from the user's home or from /, so sending the empty
  // string would root containment exactly where §19 says it must never be, and
  // would do it silently. Omitting the key instead lets the server fall back to
  // the workspace root and then the document's own directory.
  const root = typeof config.includeRoot === 'string' ? config.includeRoot.trim() : ''
  if (root !== '') payload.includeRoot = root
  if (config.allowAbsolute === true) payload.allowAbsolute = true
  return payload
}

export function carveInitializationOptions(
  input: InitializationOptionsInput,
): CarveInitializationOptions {
  return {
    carve: {
      formatter: input.formatter,
      includes: includeSettingsPayload(input.includes),
      exportActions: false,
    },
    workspaceTrusted: input.workspaceTrusted,
  }
}
