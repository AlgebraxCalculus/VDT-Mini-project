// Real-time client for the risk WebSocket gateway (APIs 44–47). The NestJS gateway
// (RiskGateway) speaks the Socket.IO protocol — not a raw WebSocket — so this wraps
// socket.io-client. One shared connection per tab; the map subscribes to its
// viewport's tile rooms and receives `risk:delta` pushes for the stations in view.
//
//   44 — connection: JWT access token sent via `auth.token` at the handshake.
//   45 — `subscribe:viewport`: join the tile rooms a bbox covers.
//   46 — `risk:delta` (server→client): a station's recomputed risk.
//   47 — `unsubscribe:viewport`: leave all viewport rooms.

import { io, type Socket } from 'socket.io-client';
import type { RiskSeverity, RiskStatus } from '../types';
import { API_BASE, getAccessToken } from './api';

/** Server→client payload of `risk:delta` (API 46) — mirrors RiskGateway.broadcastRiskDelta. */
export interface RiskDelta {
  stationId: number;
  riskStatus: RiskStatus;
  severity: RiskSeverity | null;
}

/** Same shape the viewport REST query uses (GET /stations/viewport). */
export interface ViewportBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

let socket: Socket | null = null;

/**
 * Lazily open the shared Socket.IO connection (API 44 handshake). The JWT is sent
 * via `auth.token`; passing a function makes socket.io re-read it on every
 * (re)connect, so a rotated access token is picked up without rebuilding the socket.
 */
function getSocket(): Socket {
  if (socket) return socket;
  socket = io(API_BASE, {
    // `auth` as a callback is re-invoked on every reconnect → always the latest token.
    auth: (cb) => cb({ token: getAccessToken() ?? '' }),
  });
  return socket;
}

/** Join the tile rooms the bbox covers (API 45). Emits are buffered until connected. */
export function subscribeViewport(bbox: ViewportBbox): void {
  getSocket().emit('subscribe:viewport', { bbox });
}

/** Leave all viewport rooms (API 47). No-op if the socket was never opened. */
export function unsubscribeViewport(): void {
  socket?.emit('unsubscribe:viewport', {});
}

/** Listen for risk deltas (API 46). Returns an unsubscribe fn. */
export function onRiskDelta(handler: (delta: RiskDelta) => void): () => void {
  const s = getSocket();
  s.on('risk:delta', handler);
  return () => {
    s.off('risk:delta', handler);
  };
}

/**
 * Subscribe to connection-status changes. The current state is reported on the
 * next microtask (not synchronously) so callers can `setState` from the resolved
 * callback without tripping the set-state-in-effect lint rule.
 */
export function onRealtimeStatus(handler: (status: RealtimeStatus) => void): () => void {
  const s = getSocket();
  const onConnect = () => handler('connected');
  const onDisconnect = () => handler('disconnected');
  const onError = () => handler('disconnected');
  s.on('connect', onConnect);
  s.on('disconnect', onDisconnect);
  s.on('connect_error', onError);
  Promise.resolve().then(() => handler(s.connected ? 'connected' : 'connecting'));
  return () => {
    s.off('connect', onConnect);
    s.off('disconnect', onDisconnect);
    s.off('connect_error', onError);
  };
}

/** Tear down the connection — call on logout so the next user re-handshakes fresh. */
export function closeRiskSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
