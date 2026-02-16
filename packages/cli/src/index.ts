#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import {
  initCommand,
  runCommand,
  authCommand,
  doctorCommand,
  telemetryCommand,
  exportRunCommand,
  updateCommand,
  statusCommand,
  onboardingCommand,
  incidentCommand,
  readinessCommand,
} from './commands/index.js';

/**
 * CLI entry point
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('matrix')
    .description('Matrix CLI - Agentic Development Runtime')
    .version('0.1.0')
    .option('-d, --debug', 'Enable debug mode')
    .option('-c, --config <path>', 'Path to config file')
    .hook('preAction', (thisCommand) => {
      const options = thisCommand.opts();
      if (options.debug) {
        process.env.DEBUG = 'true';
      }
    });

  // Register commands
  initCommand(program);
  runCommand(program);
  authCommand(program);
  doctorCommand(program);
  telemetryCommand(program);
  exportRunCommand(program);
  updateCommand(program);
  statusCommand(program);
  onboardingCommand(program);
  incidentCommand(program);
  readinessCommand(program);

  // Help command customization
  program.addHelpText('before', '\n' + chalk.bold.green('  Matrix CLI v0.1.0'));
  program.addHelpText('after', '\n' + chalk.dim('  Documentation: https://github.com/matrix-cli/matrix\n'));

  // Parse arguments
  await program.parseAsync(process.argv);
}

// Run main
main().catch((error) => {
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});

export { main };
