import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const LA_CALERA = [4.7203, -73.9687];

/**
 * Creates and configures the Leaflet map with satellite tiles.
 * @param {string} elementId - DOM element ID for the map container.
 * @param {[number, number]} center - [lat, lng] center coordinates.
 * @param {number} zoom - Initial zoom level.
 * @returns {L.Map} Configured Leaflet map instance.
 */
export function createMap(elementId, center = LA_CALERA, zoom = 13) {
  const map = L.map(elementId, { 
    zoomControl: false,
    maxZoom: 18 // Evita el error de "Map data not yet available"
  }).setView(center, zoom);

  // Satellite imagery
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxZoom: 18 }
  ).addTo(map);

  // Labels overlay
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18, opacity: 0.85 }
  ).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  return map;
}

/**
 * Creates a Didi-style pin icon.
 * @param {string} color - Background color (hex).
 * @param {string} label - Single character label.
 * @returns {L.DivIcon}
 */
export function pinIcon(color, label) {
  return L.divIcon({
    className: '',
    html: `<div style="width:34px;height:34px;background:${color};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid white;box-shadow:0 4px 14px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);font-size:13px;font-weight:800;color:#fff;">${label}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  });
}
