export const EXECUTE_COMMAND_METHOD = 'workspace/executeCommand'

interface CommandRegistration<T> {
  id: string
  registerOptions: T
}

export interface CommandFeature<T extends { commands?: string[] }> {
  register(data: CommandRegistration<T>): void
}

/** The command ids the extension contributes, read from its package.json. */
export function contributedCommands(packageJSON: unknown): Set<string> {
  const commands = (packageJSON as { contributes?: { commands?: { command?: unknown }[] } } | undefined)
    ?.contributes?.commands ?? []
  return new Set(commands.map((entry) => entry.command).filter((id): id is string => typeof id === 'string'))
}

/**
 * vscode-languageclient registers every command the server lists as a VS Code
 * command, and VS Code refuses a second registration of an id, which fails
 * activation. Ids the extension owns stay with the extension, so a server
 * code action naming one runs the client command.
 */
export function skipOwnedCommands<T extends { commands?: string[] }>(
  feature: CommandFeature<T>,
  owned: ReadonlySet<string>,
): void {
  const register = feature.register.bind(feature)
  feature.register = (data) => register({
    ...data,
    registerOptions: {
      ...data.registerOptions,
      commands: data.registerOptions.commands?.filter((command) => !owned.has(command)),
    },
  })
}
