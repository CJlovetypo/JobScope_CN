import {configureRuntime} from './runtime-context.mjs';

export async function runCli(context, command = 'jobs') {
  configureRuntime(context);
  if (command === 'jobs') return import('./scripts/jobs.mjs');
  if (command === 'company-profiles') return import('./scripts/company-profiles.mjs');
  throw Error('未知共享入口：'+command);
}
