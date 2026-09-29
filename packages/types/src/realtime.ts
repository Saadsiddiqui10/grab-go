/**
 * Real-time contract (Socket.IO).
 *
 * Rooms:
 *   `user:{userId}`         — a customer's own order updates
 *   `order:{orderId}`       — everyone entitled to watch one order
 *   `business:{businessId}` — the cafe's live order board
 *
 * Room membership is decided server-side from the authenticated principal; clients
 * ask to subscribe and the server verifies entitlement before joining.
 */
import type { OrderDetail, OrderSummary } from './entities';
import type { OrderStatus, PaymentStatus } from './enums';

export const RealtimeEvent = {
  ORDER_CREATED: 'order.created',
  ORDER_STATUS_CHANGED: 'order.status_changed',
  ORDER_PAYMENT_CHANGED: 'order.payment_changed',
  ORDER_UPDATED: 'order.updated',
  BUSINESS_AVAILABILITY_CHANGED: 'business.availability_changed',
  POINTS_CHANGED: 'points.changed',
} as const;
export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

export interface OrderStatusChangedPayload {
  orderId: string;
  orderNumber: string;
  businessId: string;
  status: OrderStatus;
  previousStatus: OrderStatus;
  at: string;
  estimatedReadyAt: string | null;
}

export interface OrderPaymentChangedPayload {
  orderId: string;
  paymentStatus: PaymentStatus;
  at: string;
}

export interface BusinessAvailabilityPayload {
  businessId: string;
  acceptingOrders: boolean;
  isOpenNow: boolean;
  busyUntilMinutes: number | null;
}

export interface PointsChangedPayload {
  balance: number;
  delta: number;
  reason: string;
}

/** Server -> client events, typed for `io.on`. */
export interface ServerToClientEvents {
  [RealtimeEvent.ORDER_CREATED]: (order: OrderSummary) => void;
  [RealtimeEvent.ORDER_STATUS_CHANGED]: (payload: OrderStatusChangedPayload) => void;
  [RealtimeEvent.ORDER_PAYMENT_CHANGED]: (payload: OrderPaymentChangedPayload) => void;
  [RealtimeEvent.ORDER_UPDATED]: (order: OrderDetail) => void;
  [RealtimeEvent.BUSINESS_AVAILABILITY_CHANGED]: (
    payload: BusinessAvailabilityPayload,
  ) => void;
  [RealtimeEvent.POINTS_CHANGED]: (payload: PointsChangedPayload) => void;
}

/** Client -> server events. */
export interface ClientToServerEvents {
  'subscribe:order': (orderId: string, ack?: (ok: boolean) => void) => void;
  'unsubscribe:order': (orderId: string) => void;
  'subscribe:business': (businessId: string, ack?: (ok: boolean) => void) => void;
  'unsubscribe:business': (businessId: string) => void;
}

export const realtimeRooms = {
  user: (userId: string) => `user:${userId}`,
  order: (orderId: string) => `order:${orderId}`,
  business: (businessId: string) => `business:${businessId}`,
} as const;
