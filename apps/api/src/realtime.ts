import { Server as SocketServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import {
  RealtimeEvent,
  realtimeRooms,
  type BusinessAvailabilityPayload,
  type ClientToServerEvents,
  type OrderPaymentChangedPayload,
  type OrderStatusChangedPayload,
  type OrderSummary,
  type PointsChangedPayload,
  type ServerToClientEvents,
} from '@grabgo/types';
import { verifyAccessToken } from './lib/tokens';
import { getEnv, corsOrigins } from './env';
import { prisma } from './db';

/**
 * Realtime order updates over Socket.IO.
 *
 * The customer's order screen and the cafe's live board both subscribe here, so a
 * barista tapping "Ready" lights up the customer's phone without either side
 * polling.
 *
 * Room membership is decided by the server: a client asks to watch an order, and
 * the server checks it either placed that order or staffs the cafe fulfilling it
 * before joining. A client that simply guesses an order id gets nothing.
 */

interface SocketData {
  userId: string;
  role: string;
  businesses: string[];
}

type GrabGoSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;
export type GrabGoIo = SocketServer<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

let io: GrabGoIo | null = null;

export function createRealtimeServer(httpServer: HttpServer): GrabGoIo {
  const env = getEnv();

  const server: GrabGoIo = new SocketServer(httpServer, {
    cors: { origin: corsOrigins(env), credentials: true },
    path: '/realtime',
    // Long-poll fallback matters on Karachi mobile networks, where a websocket
    // upgrade through a carrier proxy is not guaranteed.
    transports: ['websocket', 'polling'],
  });

  server.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth as { token?: string } | undefined)?.token ??
        extractBearer(socket.handshake.headers.authorization);

      if (!token) return next(new Error('UNAUTHENTICATED'));

      const claims = await verifyAccessToken(token, env.AUTH_SECRET);
      socket.data.userId = claims.sub;
      socket.data.role = claims.role;
      socket.data.businesses = claims.businesses ?? [];
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  server.on('connection', (socket: GrabGoSocket) => {
    // Everyone joins their own room; that is enough for order and points updates
    // without any subscribe call from the client.
    void socket.join(realtimeRooms.user(socket.data.userId));

    socket.on('subscribe:order', async (orderId, ack) => {
      const allowed = await canWatchOrder(socket.data, orderId);
      if (allowed) await socket.join(realtimeRooms.order(orderId));
      ack?.(allowed);
    });

    socket.on('unsubscribe:order', (orderId) => {
      void socket.leave(realtimeRooms.order(orderId));
    });

    socket.on('subscribe:business', (businessId, ack) => {
      const allowed =
        socket.data.businesses.includes(businessId) ||
        socket.data.role === 'ADMIN' ||
        socket.data.role === 'SUPER_ADMIN';

      if (allowed) void socket.join(realtimeRooms.business(businessId));
      ack?.(allowed);
    });

    socket.on('unsubscribe:business', (businessId) => {
      void socket.leave(realtimeRooms.business(businessId));
    });
  });

  io = server;
  return server;
}

function extractBearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function canWatchOrder(data: SocketData, orderId: string): Promise<boolean> {
  if (data.role === 'ADMIN' || data.role === 'SUPER_ADMIN') return true;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { userId: true, businessId: true },
  });

  if (!order) return false;
  return order.userId === data.userId || data.businesses.includes(order.businessId);
}

/* -------------------------------------------------------------- emit helpers */

/**
 * Emitting is best-effort and never blocks a database transaction. If the socket
 * layer is down, the order still moves; clients pick the change up on their next
 * fetch, which React Query does on focus and reconnect.
 */
function emit<K extends keyof ServerToClientEvents>(
  room: string,
  event: K,
  ...payload: Parameters<ServerToClientEvents[K]>
): void {
  if (!io) return;
  try {
    io.to(room).emit(event, ...payload);
  } catch (error) {
    console.error('[realtime] emit failed', event, error);
  }
}

export function emitOrderCreated(order: OrderSummary, customerId: string): void {
  // The cafe's live board gets a new ticket; the customer gets confirmation on
  // any other device they have open.
  emit(realtimeRooms.business(order.businessId), RealtimeEvent.ORDER_CREATED, order);
  emit(realtimeRooms.user(customerId), RealtimeEvent.ORDER_CREATED, order);
}

export function emitOrderStatusChanged(
  payload: OrderStatusChangedPayload,
  userId: string,
): void {
  emit(realtimeRooms.order(payload.orderId), RealtimeEvent.ORDER_STATUS_CHANGED, payload);
  emit(realtimeRooms.user(userId), RealtimeEvent.ORDER_STATUS_CHANGED, payload);
  emit(
    realtimeRooms.business(payload.businessId),
    RealtimeEvent.ORDER_STATUS_CHANGED,
    payload,
  );
}

export function emitPaymentChanged(
  payload: OrderPaymentChangedPayload,
  userId: string,
  businessId: string,
): void {
  emit(realtimeRooms.order(payload.orderId), RealtimeEvent.ORDER_PAYMENT_CHANGED, payload);
  emit(realtimeRooms.user(userId), RealtimeEvent.ORDER_PAYMENT_CHANGED, payload);
  emit(realtimeRooms.business(businessId), RealtimeEvent.ORDER_PAYMENT_CHANGED, payload);
}

export function emitBusinessAvailability(payload: BusinessAvailabilityPayload): void {
  emit(
    realtimeRooms.business(payload.businessId),
    RealtimeEvent.BUSINESS_AVAILABILITY_CHANGED,
    payload,
  );
}

export function emitPointsChanged(userId: string, payload: PointsChangedPayload): void {
  emit(realtimeRooms.user(userId), RealtimeEvent.POINTS_CHANGED, payload);
}

export async function closeRealtime(): Promise<void> {
  if (!io) return;
  await io.close();
  io = null;
}
