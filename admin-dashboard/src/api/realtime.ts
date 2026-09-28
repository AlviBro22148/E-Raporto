import * as signalR from '@microsoft/signalr';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL } from './client';

export type RealtimeEntity =
  | 'report' | 'notification' | 'duplicateCandidate' | 'citizenProfile' | 'systemicPattern'
  | 'photoReuseFlag' | 'fraudFlag';

export interface EntityChangedEvent {
  entity: RealtimeEntity;
  action: string;
  id: string;
  publicRef?: string | null;
  status?: string | null;
  occurredAt: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Keeps the dashboard's react-query cache in step with the API in real time.
 *
 * Cache invalidation rather than patching rows by hand: the event deliberately carries only an
 * identity, so the only way to render the new state is to refetch through the endpoint that already
 * authorises it. Invalidation asks react-query to do exactly that, for the queries that are actually
 * mounted, and leaves everything else untouched until the screen needing it is opened.
 *
 * The write path needs nothing added — every admin action already goes through the API, and the API
 * broadcasts on success — so this is purely the listening half.
 */
export function useRealtimeSync(enabled: boolean): ConnectionState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>('disconnected');

  useEffect(() => {
    if (!enabled) return;

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${API_URL}/hubs/realtime`, {
        // No accessTokenFactory: the staff session rides the httpOnly cookie, which the browser
        // attaches to the hub's negotiate/WebSocket requests on its own — there's no token for this
        // client to read any more. withCredentials is explicit rather than relying on the library's
        // default, since dashboard and API run on different ports (a cross-origin request as far as
        // the browser's credential rules are concerned, even though they're the same site).
        withCredentials: true,
      })
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: retry =>
          [0, 2000, 10_000, 30_000][retry.previousRetryCount] ?? 30_000,
      })
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connection.on('EntityChanged', (event: EntityChangedEvent) => {
      switch (event.entity) {
        case 'report':
          // The queue, the analytics tiles and this specific report's detail all derive from reports.
          queryClient.invalidateQueries({ queryKey: ['reports'] });
          queryClient.invalidateQueries({ queryKey: ['report', event.id] });
          queryClient.invalidateQueries({ queryKey: ['analytics'] });
          queryClient.invalidateQueries({ queryKey: ['trend'] });
          // A merge resolves suggestions, and a new report can create them.
          queryClient.invalidateQueries({ queryKey: ['duplicates'] });
          break;

        case 'duplicateCandidate':
          queryClient.invalidateQueries({ queryKey: ['duplicates'] });
          queryClient.invalidateQueries({ queryKey: ['reports'] });
          break;

        case 'systemicPattern':
          queryClient.invalidateQueries({ queryKey: ['patterns'] });
          queryClient.invalidateQueries({ queryKey: ['pattern', event.id] });
          queryClient.invalidateQueries({ queryKey: ['analytics'] });
          // A report just joined or seeded a pattern — its detail card and the queue's badge need it.
          queryClient.invalidateQueries({ queryKey: ['reports'] });
          break;

        case 'fraudFlag':
          queryClient.invalidateQueries({ queryKey: ['fraud'] });
          queryClient.invalidateQueries({ queryKey: ['reports'] });
          queryClient.invalidateQueries({ queryKey: ['analytics'] });
          break;

        // Fires alongside 'fraudFlag' for a PhotoReuse-kind flag specifically — kept only because the
        // mobile app's own dedicated photo-reuse screen still listens for it; the dashboard doesn't have
        // a separate page for it any more, 'fraudFlag' above already covers everything this would.
        case 'photoReuseFlag':
          break;

        // notification and citizenProfile are per-citizen and never reach a staff connection; they are
        // listed so this switch stays exhaustive if the contract grows.
        case 'notification':
        case 'citizenProfile':
          break;
      }
    });

    connection.onreconnecting(() => setState('reconnecting'));
    connection.onreconnected(() => {
      setState('connected');
      // Anything could have changed while the socket was down, and no event was delivered for it.
      queryClient.invalidateQueries();
    });
    connection.onclose(() => setState('disconnected'));

    setState('connecting');
    connection.start()
      .then(() => setState('connected'))
      .catch(() => setState('disconnected'));   // the dashboard still works on plain fetches

    return () => {
      // off() before stop(), so a re-run of this effect (a re-login, say) cannot leave the previous
      // handler attached and invalidating the cache twice per event.
      connection.off('EntityChanged');
      void connection.stop();
      setState('disconnected');
    };
  }, [enabled, queryClient]);

  return state;
}
