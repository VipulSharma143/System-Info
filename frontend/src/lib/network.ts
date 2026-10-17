import type { NetworkInfo } from '../types/system';

/** An interface counts as active only if it is actually moving bytes right now. */
export const isLive = (n: NetworkInfo) => n.rxKBps > 0.1 || n.txKBps > 0.1;

export type InterfaceKind = 'loopback' | 'wifi' | 'ethernet' | 'virtual' | 'other';

export const KIND_LABEL: Record<InterfaceKind, string> = {
  loopback: 'Loopback',
  wifi: 'Wi-Fi',
  ethernet: 'Ethernet',
  virtual: 'Virtual',
  other: 'Network',
};

/**
 * A hint taken from the interface's NAME only (the backend reports no adapter type), so the screen labels it as inferred.
 * Unknown names stay `other`; nothing is guessed beyond well-known naming conventions of Windows and Linux.
 */
export function interfaceKind(name: string): InterfaceKind {
  const n = name.toLowerCase();
  if (n === 'lo' || n.includes('loopback')) return 'loopback';
  if (/^(docker|veth|br-|virbr|vmnet|vboxnet|tun|tap|tailscale|zt|wg)/.test(n) || /(virtual|vethernet|vmware|hyper-v|vpn|bluetooth)/.test(n)) return 'virtual';
  if (/^(wl|wlan|wifi|ath)/.test(n) || /(wi-?fi|wireless)/.test(n)) return 'wifi';
  if (/^(en|eth)/.test(n) || /ethernet/.test(n)) return 'ethernet';
  return 'other';
}

export interface InterfaceRow {
  net: NetworkInfo;
  kind: InterfaceKind;
  live: boolean;
  /** Share of all current traffic (0..100); 0 when nothing is moving. */
  share: number;
}

/** Active interfaces first, busiest first; idle ones follow alphabetically. Nothing is hidden. */
export function interfaceRows(network: readonly NetworkInfo[]): InterfaceRow[] {
  const total = network.reduce((s, n) => s + n.rxKBps + n.txKBps, 0);
  return network
    .map((net) => ({ net, kind: interfaceKind(net.iface), live: isLive(net), share: total > 0 ? ((net.rxKBps + net.txKBps) / total) * 100 : 0 }))
    .sort((a, b) => Number(b.live) - Number(a.live) || b.net.rxKBps + b.net.txKBps - (a.net.rxKBps + a.net.txKBps) || a.net.iface.localeCompare(b.net.iface));
}

export interface SeriesSummary {
  peak: number;
  average: number;
}

/** Peak and mean of the visible window; null for an empty series (no data is not "0"). */
export function summarise(series: readonly number[]): SeriesSummary | null {
  if (series.length === 0) return null;
  return { peak: Math.max(...series), average: series.reduce((s, v) => s + v, 0) / series.length };
}
