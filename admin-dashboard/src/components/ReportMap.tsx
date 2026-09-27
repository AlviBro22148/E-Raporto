import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import 'leaflet/dist/leaflet.css';
import type { ReportListItemDto } from '../api/types';
import { STATUS_LABEL, formatRelative } from './ui';

const ELBASAN: [number, number] = [41.1125, 20.0822];

/**
 * Pins are sized by confirmation count and coloured by category, so a cluster of reports about the
 * same street reads as one loud problem rather than as visual noise. Category colour comes from the
 * API, never from a local constant — the map, the chips and the charts share one source.
 */
function pinIcon(colorHex: string, confirmations: number, breached: boolean) {
  const size = Math.min(14 + Math.sqrt(Math.max(confirmations, 1)) * 4, 30);
  return L.divIcon({
    className: '',
    html: `<div class="pin" style="
      width:${size}px;height:${size}px;background:${colorHex};
      ${breached ? 'box-shadow:0 0 0 3px rgba(185,28,28,.55),0 1px 4px rgba(0,0,0,.35);' : ''}
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Keeps the viewport on the data as filters change, without fighting a user who has panned. */
function FitToReports({ reports }: { reports: ReportListItemDto[] }) {
  const map = useMap();

  useEffect(() => {
    if (reports.length === 0) return;
    const bounds = L.latLngBounds(reports.map(r => [r.latitude, r.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
  }, [reports, map]);

  return null;
}

export function ReportMap({
  reports, height = 420, selectedId, onSelect,
}: {
  reports: ReportListItemDto[];
  height?: number | string;
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const markers = useMemo(
    () => reports.filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)),
    [reports],
  );

  return (
    <MapContainer
      center={ELBASAN}
      zoom={13}
      style={{ height, width: '100%', borderRadius: 'var(--radius)' }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToReports reports={markers} />

      {markers.map(report => (
        <Marker
          key={report.id}
          position={[report.latitude, report.longitude]}
          icon={pinIcon(report.category?.colorHex ?? '#868e96', report.confirmationCount, report.isSlaBreached)}
          zIndexOffset={report.id === selectedId ? 1000 : 0}
          eventHandlers={onSelect ? { click: () => onSelect(report.id) } : undefined}
        >
          <Popup>
            <div className="stack-4" style={{ minWidth: 190 }}>
              <span className="mono muted" style={{ fontSize: 11 }}>{report.publicRef}</span>
              <strong style={{ fontSize: 13, lineHeight: 1.35 }}>{report.title}</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                {report.category?.nameSq} · {STATUS_LABEL[report.status]}
              </span>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {formatRelative(report.createdAt)}
                {report.confirmationCount > 1 && ` · ${report.confirmationCount} konfirmime`}
              </span>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
