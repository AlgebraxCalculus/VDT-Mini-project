// Socket.IO client for the risk gateway (APIs 44–47): one shared connection per tab
// that subscribes to the map viewport's tile rooms and receives `risk:delta` pushes.

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
 * Lazily open the shared connection (API 44). `auth` as a callback is re-invoked on
 * every reconnect, so a rotated access token is picked up without rebuilding the socket.
 */
function getSocket(): Socket {
  if (socket) return socket;
  socket = io(API_BASE, {
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

/** Subscribe to connection-status changes; current state is reported on the next microtask. */
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
