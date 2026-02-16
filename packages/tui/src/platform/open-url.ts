import { spawn } from 'child_process';

export interface OpenUrlResult {
  success: boolean;
  error?: string;
}

function getOpenCommand(url: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: 'cmd',
      args: ['/c', 'start', '', url],
    };
  }

  if (process.platform === 'darwin') {
    return {
      command: 'open',
      args: [url],
    };
  }

  return {
    command: 'xdg-open',
    args: [url],
  };
}

export async function openExternalUrl(rawUrl: string): Promise<OpenUrlResult> {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    return {
      success: false,
      error: 'Only HTTP/HTTPS URLs can be opened automatically.',
    };
  }

  try {
    const { command, args } = getOpenCommand(url);
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.on('error', () => {
      // Process start failures are handled by the fallback message in callers.
    });
    child.unref();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to open URL.',
    };
  }
}
