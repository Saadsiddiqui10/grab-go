import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  RealtimeEvent,
  type OrderStatusChangedPayload,
  type OrderPaymentChangedPayload,
} from '@grabgo/types';
import { REALTIME_URL, getAccessToken } from './client';
import { useAuthStore } from '../stores/auth';
import { queryKeys } from './hooks';
import { successFeedback } from '../lib/feedback';

/**
 * Live order updates.
 *
 * The customer watching their order should see "Ready" the moment the barista
 * taps it, without pulling to refresh. The socket carries the signal; React
 * Query still owns the data, so an event invalidates a query rather than writing
 * cached state the rest of the app cannot see.
 *
 * The connection is torn down when the app goes to the background — a socket
 * held open behind a locked screen drains battery and will be killed by the OS
 * anyway. Push notifications cover that window.
 */
export function useRealtime(): void {
  const client = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    const connect = (): void => {
      if (socketRef.current?.connected) return;

      const token = getAccessToken();
      if (!token) return;

      const socket = io(REALTIME_URL, {
        path: '/realtime',
        auth: { token },
        transports: ['websocket'],
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10_000,
        // Give up eventually rather than retrying forever on a dead network;
        // the polling fallback in `useOrder` keeps the screen correct.
        reconnectionAttempts: 10,
      });

      socket.on(RealtimeEvent.ORDER_STATUS_CHANGED, (payload: OrderStatusChangedPayload) => {
        void client.invalidateQueries({ queryKey: queryKeys.order(payload.orderId) });
        void client.invalidateQueries({ queryKey: ['orders'] });

        // A small confirmation when the order becomes collectable — this is the
        // moment the whole product exists for.
        if (payload.status === 'READY') successFeedback();
      });

      socket.on(RealtimeEvent.ORDER_PAYMENT_CHANGED, (payload: OrderPaymentChangedPayload) => {
        void client.invalidateQueries({ queryKey: queryKeys.order(payload.orderId) });
      });

      socket.on(RealtimeEvent.POINTS_CHANGED, () => {
        void client.invalidateQueries({ queryKey: queryKeys.points });
      });

      socket.on('connect_error', () => {
        // Expected on a flaky connection or an expired token; the REST layer
        // continues to work, so this is not surfaced to the customer.
      });

      socketRef.current = socket;
    };

    const disconnect = (): void => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };

    connect();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        connect();
        // Whatever changed while backgrounded is caught by a refetch.
        void client.invalidateQueries({ queryKey: ['orders'] });
      } else {
        disconnect();
      }
    });

    return () => {
      subscription.remove();
      disconnect();
    };
  }, [isAuthenticated, client]);
}

/** Watch one order's room, for the tracking screen. */
export function useOrderSubscription(orderId: string | undefined): void {
  const client = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  useEffect(() => {
    if (!orderId || !isAuthenticated) return;

    const token = getAccessToken();
    if (!token) return;

    const socket = io(REALTIME_URL, {
      path: '/realtime',
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      socket.emit('subscribe:order', orderId);
    });

    socket.on(RealtimeEvent.ORDER_STATUS_CHANGED, () => {
      void client.invalidateQueries({ queryKey: queryKeys.order(orderId) });
    });

    return () => {
      socket.emit('unsubscribe:order', orderId);
      socket.disconnect();
    };
  }, [orderId, isAuthenticated, client]);
}
