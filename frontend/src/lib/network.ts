import type { NetworkInfo } from '../types/system';

/** An interface counts as active only if it is actually moving bytes right now. */
export const isLive = (n: NetworkInfo) => n.rxKBps > 0.1 || n.txKBps > 0.1;
