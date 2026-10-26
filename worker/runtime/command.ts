import { execFile } from 'node:child_process';

// Both programs and arguments are chosen by adapters, never by the model or UI.
// Provider output/stderr is intentionally excluded from application errors.
export type CommandRunner = (program: 'kubectl' | 'az', args: string[]) => Promise<string>;
export function commandJson(source: string): any {
  try { return JSON.parse(source); }
  catch { throw new Error('O conector recebeu JSON inválido do provedor.'); }
}
export const runCommand: CommandRunner = (program, args) => new Promise((resolve, reject) => {
  const executable = program === 'kubectl' ? process.env.KUBECTL_BIN || 'kubectl' : process.env.AZ_CLI_BIN || 'az';
  execFile(executable, args, { env: {...process.env,AZURE_EXTENSION_USE_DYNAMIC_INSTALL:'no'}, timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
    if (error) reject(new Error('O conector ' + program + ' não concluiu a operação. Confira acesso, permissões e disponibilidade.'));
    else resolve(stdout);
  });
});
