import WebSocket from 'ws';
import { ethers } from 'ethers';
import { getConfig } from '../config';
import type { MempoolWatcher } from './mempoolWatcher';

// Reuse or create Prometheus counters safely without double-registration
let promClient: typeof import('prom-client') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  promClient = require('prom-client');
} catch {
  // prom-client not present; metrics usage will be a no-op
}

function ensureCounter(name: string, help: string, labelNames: string[] = []) {
  if (!promClient) return null;
  const existing = promClient.register.getSingleMetric(name) as import('prom-client').Counter<string> | undefined;
  if (existing) return existing;
  return new promClient.Counter({ name, help, labelNames });
}

const txsSeenCounter = ensureCounter('mempool_txs_seen_total', 'Total mempool transactions seen by source', ['source']);
const swapsDecodedCounter = ensureCounter('mempool_swaps_decoded_total', 'Total decoded swaps by source', ['source']);

type BloxrouteTx = {
  tx_hash: string;
  tx_contents?: {
    to?: string | null;
    input?: string | null;
    from?: string | null;
    value?: string | null; // hex string
  };
};

const ROUTERS = new Map(
  [
    ['0xe592427a0aece92de3edee1f18e0157c05861564', 'SwapRouter'],
    ['0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', 'SwapRouter02'],
    ['0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b', 'UniversalRouter'],
  ].map(([addr, name]) => [addr.toLowerCase(), name])
);

export function startBloxrouteWatcher(params: { watcher: MempoolWatcher; seenTxHashes?: Set<string> }) {
  const { watcher } = params;
  const seen = params.seenTxHashes ?? new Set<string>();

  const config = getConfig();
  if (!config.useBloxroute) {
    return;
  }

  const url = config.bloxrouteWsUrl;
  const auth = config.bloxrouteAuthHeader;
  const source = 'bloxroute';

  if (!url || !auth) {
    console.warn('⚠️  bloXroute watcher not started (missing BLOXROUTE_WS_URL or BLOXROUTE_AUTH_HEADER)');
    return;
  }

  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  let closedByUs = false;

  const subscribeMsg = {
    method: 'subscribe',
    id: 1,
    params: {
      subscription: 'pendingTxs',
      include: ['tx_hash', 'tx_contents.to', 'tx_contents.input', 'tx_contents.from', 'tx_contents.value'],
    },
  };

  function connect() {
    ws = new WebSocket(url, {
      headers: { Authorization: auth },
    });

    ws.on('open', () => {
      reconnectAttempts = 0;
      ws?.send(JSON.stringify(subscribeMsg));
      console.log(JSON.stringify({ component: 'mempool-watcher', msg: 'bloXroute connected and subscribed', url }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(msg);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('error', (err) => {
      console.error('[bloxroute] ws error:', (err as Error)?.message || err);
    });

    ws.on('close', (code) => {
      if (closedByUs) return;
      const backoffMs = Math.min(30_000, 1_000 * Math.pow(2, reconnectAttempts++));
      console.warn(`[bloxroute] ws closed (${code}). Reconnecting in ${backoffMs}ms`);
      setTimeout(connect, backoffMs);
    });

    process.on('SIGINT', () => {
      closedByUs = true;
      try { ws?.close(); } catch {}
    });
  }

  function handleMessage(msg: any) {
    const updates = normalizeUpdates(msg);
    if (!updates.length) return;

    for (const u of updates) {
      const txHash = (u.tx_hash || '').toLowerCase();
      if (!txHash) continue;

      try {
        txsSeenCounter?.labels({ source }).inc();
      } catch {}

      if (seen.has(txHash)) continue;

      const to = (u.tx_contents?.to || '').toLowerCase();
      const routerName = ROUTERS.get(to);
      if (!routerName) {
        continue; // only process known Uniswap routers
      }

      // Mark as seen once relevant
      seen.add(txHash);

      const input = u.tx_contents?.input || '0x';
      const from = u.tx_contents?.from || undefined;
      const valueHex = u.tx_contents?.value || '0x0';
      const value = safeParseValue(valueHex);

      console.log(JSON.stringify({
        component: 'mempool-watcher',
        msg: 'bloXroute pending TX received',
        txHash,
        router: routerName,
        source,
      }));

      // Build a minimal TransactionResponse-like object
      const tx: ethers.providers.TransactionResponse = {
        hash: txHash,
        to: ethers.utils.getAddress(to),
        from: from ? ethers.utils.getAddress(from) : undefined,
        data: input,
        value: ethers.BigNumber.from(value),
      } as any;

      // Reuse internal decoder; TS-private only, so cast to any
      (async () => {
        try {
          const decoded = await (watcher as any).parseSwapTransaction(tx, '');
          if (decoded) {
            try {
              swapsDecodedCounter?.labels({ source }).inc();
            } catch {}
            // Emit using the watcher's event emitter
            // If your code listens to a specific event name, adjust as needed.
            (watcher as any).emit?.('PendingSwapDetected', decoded);
          }
        } catch (err) {
          // swallow
        }
      })();
    }
  }

  function normalizeUpdates(msg: any): BloxrouteTx[] {
    const r1 = msg?.params?.result;
    const r2 = msg?.result;
    const candidate = r1 ?? r2 ?? msg;
    if (!candidate) return [];
    if (Array.isArray(candidate)) return candidate;
    if (candidate?.tx_hash) return [candidate];
    return [];
  }

  function safeParseValue(hex?: string | null): string {
    try {
      if (!hex) return '0';
      return ethers.BigNumber.from(hex).toString();
    } catch {
      return '0';
    }
  }

  connect();
}