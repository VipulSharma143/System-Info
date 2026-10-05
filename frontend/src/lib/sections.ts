import type { Hue } from './hues';

export const SECTIONS = [
  { id: 'overview', label: 'Overview', hue: 'overview', title: 'Overview', description: 'How the machine is doing right now' },
  { id: 'analytics', label: 'Analytics', hue: 'analytics', title: 'Analytics', description: 'Trends, stats and bottleneck history' },
  { id: 'processes', label: 'Processes', hue: 'cpu', title: 'Processes', description: 'What is running, by memory' },
  { id: 'ram', label: 'RAM', hue: 'ram', title: 'Memory', description: 'Usage, installed modules and health' },
  { id: 'gpu', label: 'GPU', hue: 'gpu', title: 'Graphics', description: 'Adapters, video memory and live telemetry' },
  { id: 'storage', label: 'Storage', hue: 'disk', title: 'Storage', description: 'Drives, capacity and free space' },
  { id: 'network', label: 'Network', hue: 'net', title: 'Network', description: 'Traffic, interfaces and connection speed' },
  { id: 'battery', label: 'Battery', hue: 'power', title: 'Battery', description: 'Charge, health and power draw' },
  { id: 'system', label: 'System', hue: 'sys', title: 'System', description: 'Hardware and operating system details' },
  { id: 'updates', label: 'Updates', hue: 'updates', title: 'Updates', description: 'New versions and release notes' },
] as const satisfies readonly { id: string; label: string; hue: Hue; title: string; description: string }[];

export type SectionId = (typeof SECTIONS)[number]['id'];

export const sectionById = (id: SectionId) => SECTIONS.find((s) => s.id === id)!;
