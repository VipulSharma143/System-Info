import { parseBehaviorState, type BehaviorState, type StartupBehavior } from './behavior.ts';

/** The only two calls the frontend makes about the background/startup preference; both go to the desktop shell. */
async function call(command: 'get_startup_behavior' | 'set_startup_behavior', args?: Record<string, unknown>): Promise<BehaviorState> {
  const { invoke } = await import('@tauri-apps/api/core');
  const parsed = parseBehaviorState(await invoke(command, args));
  if (!parsed) throw new Error(`${command} returned an unexpected reply`);
  return parsed;
}

export const getBehavior = () => call('get_startup_behavior');
export const setBehavior = (behavior: StartupBehavior) => call('set_startup_behavior', { behavior });

/** True when Exit / the cross button will keep the app running (a background mode with a working tray). */
export function keepsRunning(state: BehaviorState): boolean {
  return state.behavior !== 'off' && state.trayAvailable;
}
