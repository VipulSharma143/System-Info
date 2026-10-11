// Startup checklist shown while the backend loads. Kept out of the component file so that file only exports components.
export interface StartupStep {
  label: string;
  done: boolean;
}

// The four dashboard lines share one flag because they arrive together in a single
// /api/system/all response. System identity and GPU details load later, when the System page opens.
export function buildStartupSteps(args: { servicesReady: boolean; metricsLoaded: boolean }): StartupStep[] {
  return [
    { label: 'Starting System Info', done: true },
    { label: 'Loading services', done: args.servicesReady },
    { label: 'Reading processor', done: args.metricsLoaded },
    { label: 'Reading memory', done: args.metricsLoaded },
    { label: 'Reading storage', done: args.metricsLoaded },
    { label: 'Reading network', done: args.metricsLoaded },
  ];
}
