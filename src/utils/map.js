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
    maxZoom: 18 // Tope real para evitar cuadros de "Map data not available"
  }).setView(center, zoom);

  // Satellite imagery
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { 
      attribution: 'Tiles © Esri', 
      maxNativeZoom: 17, 
      maxZoom: 18 
    }
  ).addTo(map);

  // Labels overlay
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { 
      maxNativeZoom: 17, 
      maxZoom: 18, 
      opacity: 0.85 
    }
  ).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Fix para iPhone Safari: fuerza al mapa a recalcular su tamaño
  setTimeout(() => map.invalidateSize(), 300);

  return map;
}

/**
 * Creates premium A/B map markers.
 * @param {string} color - Background color (hex).
 * @param {string} label - 'A' or 'B'.
 * @returns {L.DivIcon}
 */
export function pinIcon(color, label) {
  if (label === 'A') {
    // Uber-style Start: Pulsing Green Dot
    return L.divIcon({
      className: 'premium-start-pin',
      html: `<div style="position:relative; width:24px; height:24px;">
               <div style="position:absolute; top:0; left:0; width:100%; height:100%; background:#30D158; border-radius:50%; animation: zippy-pulse 2s infinite;"></div>
               <div style="position:absolute; top:6px; left:6px; width:12px; height:12px; background:#1A1A1E; border:2px solid #30D158; border-radius:50%; z-index:2; box-shadow: 0 2px 4px rgba(0,0,0,0.5);"></div>
             </div>
             <style>@keyframes zippy-pulse { 0% { transform: scale(0.8); opacity: 0.8; } 100% { transform: scale(2.5); opacity: 0; } }</style>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  } else {
    // Uber-style End: Sleek Black Square with colored center
    return L.divIcon({
      className: 'premium-end-pin',
      html: `<div style="width:18px; height:18px; background:#111; border:2px solid #fff; display:flex; align-items:center; justify-content:center; box-shadow:0 3px 8px rgba(0,0,0,0.6);">
               <div style="width:6px; height:6px; background:${color};"></div>
             </div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }
}

/**
 * Creates a highly realistic top-down motorcycle map icon.
 * @returns {L.DivIcon}
 */
export function motoIcon() {
  return L.divIcon({
    className: 'real-moto-wrapper',
    html: `<div class="moto-rotate" style="width:30px; height:60px; transform: rotate(0deg); filter: drop-shadow(0px 8px 10px rgba(0,0,0,0.5));">
            <svg viewBox="0 0 100 200" width="100%" height="100%">
              <!-- Llanta trasera -->
              <rect x="42" y="130" width="16" height="45" rx="5" fill="#1a1a1a"/>
              <!-- Guardabarros trasero -->
              <path d="M40 120 Q50 110 60 120 L58 150 Q50 155 42 150 Z" fill="#2c2c2c"/>
              <!-- Llanta delantera -->
              <rect x="44" y="15" width="12" height="40" rx="5" fill="#1a1a1a"/>
              <!-- Horquilla delantera -->
              <rect x="40" y="35" width="20" height="10" fill="#444"/>
              <!-- Manubrio -->
              <rect x="15" y="50" width="70" height="6" rx="3" fill="#333"/>
              <!-- Puños -->
              <rect x="10" y="48" width="10" height="10" rx="2" fill="#111"/>
              <rect x="80" y="48" width="10" height="10" rx="2" fill="#111"/>
              <!-- Tanque de gasolina (Naranja Zippy) -->
              <path d="M40 60 C25 65 25 105 40 115 L60 115 C75 105 75 65 60 60 Z" fill="#FF6B00"/>
              <!-- Luces / Tablero -->
              <circle cx="50" cy="40" r="6" fill="#ddd"/>
              <circle cx="50" cy="40" r="3" fill="#fff"/>
              <!-- Asiento -->
              <path d="M42 110 C35 115 38 145 42 150 L58 150 C62 145 65 115 58 110 Z" fill="#111"/>
              <!-- Motor/Laterales -->
              <rect x="35" y="85" width="30" height="20" rx="5" fill="#444"/>
            </svg>
           </div>`,
    iconSize: [30, 60],
    iconAnchor: [15, 30]
  });
}

/**
 * Animates a Leaflet marker smoothly and rotates it towards travel direction.
 * @param {L.Marker} marker 
 * @param {[number, number]} newLatLng 
 * @param {number} durationMs 
 */
export function animateMarker(marker, newLatLng, durationMs = 2000) {
  const startLatLng = marker.getLatLng();
  const endLatLng = L.latLng(newLatLng);
  
  if (!startLatLng || (startLatLng.lat === endLatLng.lat && startLatLng.lng === endLatLng.lng)) {
    marker.setLatLng(endLatLng);
    return;
  }

  // Calcular el ángulo (Bearing) para rotar la moto
  const dLng = (endLatLng.lng - startLatLng.lng) * Math.PI / 180;
  const lat1 = startLatLng.lat * Math.PI / 180;
  const lat2 = endLatLng.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brng = Math.atan2(y, x) * 180 / Math.PI;

  const el = marker.getElement();
  if (el) {
    const inner = el.querySelector('.moto-rotate');
    if (inner) {
      inner.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
      inner.style.transform = `rotate(${brng}deg)`;
    }
  }

  const startTime = performance.now();

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    let progress = elapsed / durationMs;
    
    // Ease-out cubic
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

/**
 * Puntos del polígono de cobertura de ZIPPY.
 * Puntos: Sopó, Cra 7 con 245, Cra 7 con 85, Rural Sur, Rural Este.
 */
export const COVERAGE_POLYGON = [
  [4.91, -73.94], // Sopó Norte
  [4.85, -73.90], // Noreste (Veredas Sopó)
  [4.72, -73.87], // Este (Rural Calera +10km)
  [4.62, -74.00], // Sur (Veredas Sur)
  [4.66, -74.05], // Suroccidente (Cra 7 con Calle 85)
  [4.68, -74.04], // Occidente (Cra 7 con Calle 100)
  [4.82, -74.03]  // Noroccidente (Cra 7 con Calle 245 / Torca)
];

/**
 * Algoritmo de Ray-casting para determinar si un punto {lat, lng} está dentro de un polígono.
 * @param {object} point - {lat, lng}
 * @param {Array} polygon - Array de [lat, lng]
 */
export function isPointInPolygon(point, polygon) {
  const x = point.lat, y = point.lng;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
