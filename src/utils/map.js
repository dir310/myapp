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
    minZoom: 10,
    maxZoom: 19 // Los tiles escalan hasta aquí sin ponerse negros
  }).setView(center, zoom);

  // Satellite imagery
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxNativeZoom: 17, maxZoom: 19 }
  ).addTo(map);

  // Labels overlay
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 17, maxZoom: 19, opacity: 0.85 }
  ).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Fix para iPhone Safari: fuerza al mapa a recalcular su tamaño
  setTimeout(() => map.invalidateSize(), 300);

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

/**
 * Creates a professional motorcycle map icon.
 * @returns {L.DivIcon}
 */
export function motoIcon() {
  return L.divIcon({
    className: 'moto-icon-wrapper',
    html: `<div style="width:40px; height:40px; background:#fff; border-radius:50%; border:3px solid #FF6B00; box-shadow: 0 4px 12px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;">
            <svg viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px; height:24px;">
                <circle cx="5" cy="18" r="3"></circle>
                <circle cx="19" cy="18" r="3"></circle>
                <path d="M5 15h14"></path>
                <path d="M12 15V8L8 8V15"></path>
                <path d="M15 15v-4l4-2"></path>
            </svg>
           </div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
}

/**
 * Animates a Leaflet marker smoothly from its current position to a new LatLng.
 * @param {L.Marker} marker 
 * @param {[number, number]} newLatLng 
 * @param {number} durationMs 
 */
export function animateMarker(marker, newLatLng, durationMs = 2000) {
  const startLatLng = marker.getLatLng();
  const endLatLng = L.latLng(newLatLng);
  
  if (!startLatLng) {
    marker.setLatLng(endLatLng);
    return;
  }

  const startTime = performance.now();

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    let progress = elapsed / durationMs;
    
    // Ease-out cubic calculation for smooth slide
    progress = 1 - Math.pow(1 - progress, 3);
    
    if (progress > 1) progress = 1;

    const currentLat = startLatLng.lat + (endLatLng.lat - startLatLng.lat) * progress;
    const currentLng = startLatLng.lng + (endLatLng.lng - startLatLng.lng) * progress;

    marker.setLatLng([currentLat, currentLng]);

    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  }

  requestAnimationFrame(animate);
}
