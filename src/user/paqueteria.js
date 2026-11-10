/**
 * 📦 Paquetería ZIPPY — Módulo de envíos con tarifas calculadas y pagos (Efectivo & Wompi)
 * Completamente modular, compatible y seguro.
 */
import { supabase } from '../config/supabase.js';
import { generateRideCode } from '../utils/id.js';

let _currentUser = null;
let _origenCoords = null;   // { lat, lng, name }
let _destinoCoords = null;  // { lat, lng, name }
let _currentDistanceKm = 0;
let _currentDurationMin = 0;
let _currentTarifa = 0;
let _selectedPaga = 'remitente';     // 'remitente' | 'destinatario'
let _selectedMetodo = 'efectivo';   // 'efectivo' | 'wompi'
let _suggTimers = {};

const WOMPI_PUB_KEY = 'pub_prod_SxZqnd7Fi3WqOdXDFGrDg0qNP0rMFtE4';
const WOMPI_INTEGRITY_SECRET = 'prod_integrity_lImL3CgFSTzGzBcs661J1WF9UFJdHuZC';
const VIEWBOX = '-74.20,5.05,-73.75,4.55'; // Cobertura ZIPPY (La Calera, Sopó, Bogotá corredores)

/* ══════════════════════════════════════
   INIT — llamado desde main.js
   ══════════════════════════════════════ */
export function initPaqueteria(userId) {
  _currentUser = userId;

  // Botón "📦 Paquetería" en sidebar
  document.getElementById('paqueteriaBtn')?.addEventListener('click', openPaqueteriaPanel);

  // Cerrar panel principal
  document.getElementById('closePaqueteriaBtn')?.addEventListener('click', closePaqueteriaPanel);
  document.getElementById('paqueteriaModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('paqueteriaModal')) closePaqueteriaPanel();
  });

  // Botón nuevo paquete
  document.getElementById('nuevoPaqueteBtn')?.addEventListener('click', openPaqueteForm);

  // Cerrar formulario
  document.getElementById('closePaqueteFormBtn')?.addEventListener('click', closePaqueteForm);
  document.getElementById('paqueteFormModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('paqueteFormModal')) closePaqueteForm();
  });

  // Submit del formulario
  document.getElementById('paqueteFormEl')?.addEventListener('submit', handlePaqueteSubmit);

  // Preview foto
  document.getElementById('pkFotoInput')?.addEventListener('change', handleFotoPreview);

  // Listeners de autocompletado de origen y destino
  setupAddressAutocomplete('pkOrigen', 'pkOrigenSugg', (coords) => {
    _origenCoords = coords;
    recalcularTarifaPaquete();
  });

  setupAddressAutocomplete('pkDestino', 'pkDestinoSugg', (coords) => {
    _destinoCoords = coords;
    recalcularTarifaPaquete();
  });

  // Cambio de tamaño (radio buttons)
  document.querySelectorAll('input[name="pkTamano"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.pk-size-card').forEach((card) => card.classList.remove('checked'));
      radio.closest('.pk-size-card')?.classList.add('checked');
      recalcularTarifaPaquete();
    });
  });

  // Configuración de botones "Quién paga" y "Método"
  setupPaymentSelectors();

  // Cerrar sugerencias al hacer clic afuera
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pk-addr-wrap')) {
      document.querySelectorAll('.pk-sugg').forEach((el) => (el.style.display = 'none'));
    }
  });

  // Escuchar cambios en realtime para refrescar lista si está abierta
  supabase
    .channel('paquetes-user-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'paquetes' }, () => {
      const modal = document.getElementById('paqueteriaModal');
      if (modal && modal.style.display === 'flex') {
        loadPaquetes();
      }
    })
    .subscribe();
}

/* ══════════════════════════════════════
   PANEL PRINCIPAL
   ══════════════════════════════════════ */
function openPaqueteriaPanel() {
  const modal = document.getElementById('paqueteriaModal');
  if (!modal) return;
  modal.style.display = 'flex';
  loadPaquetes();

  const sidebar = document.getElementById('sidebar');
  if (sidebar && !sidebar.classList.contains('minimized')) {
    sidebar.classList.add('minimized');
  }
}

function closePaqueteriaPanel() {
  const modal = document.getElementById('paqueteriaModal');
  if (modal) modal.style.display = 'none';
}

function getUserId() {
  return _currentUser || localStorage.getItem('calmovil_cliente_id');
}

/* ══════════════════════════════════════
   FORMULARIO NUEVO PAQUETE
   ══════════════════════════════════════ */
function openPaqueteForm() {
  closePaqueteriaPanel();
  const formModal = document.getElementById('paqueteFormModal');
  if (formModal) formModal.style.display = 'flex';

  document.getElementById('paqueteFormEl')?.reset();
  const preview = document.getElementById('pkFotoPreview');
  if (preview) preview.style.display = 'none';

  _origenCoords = null;
  _destinoCoords = null;
  _currentDistanceKm = 0;
  _currentDurationMin = 0;
  _currentTarifa = 0;
  _selectedPaga = 'remitente';
  _selectedMetodo = 'efectivo';

  // Desmarcar clases en radios y tarjetas
  document.querySelectorAll('.pk-size-card').forEach((c) => c.classList.remove('checked'));
  const radioPequeno = document.querySelector('input[name="pkTamano"][value="pequeno"]');
  if (radioPequeno) {
    radioPequeno.checked = true;
    radioPequeno.closest('.pk-size-card')?.classList.add('checked');
  }

  // Restablecer estilos en selectores de pago
  updatePaymentUI();

  // Limpiar clases de validación en inputs de dirección
  document.getElementById('pkOrigen')?.classList.remove('pk-addr-ok');
  document.getElementById('pkDestino')?.classList.remove('pk-addr-ok');

  // Resetear tarjeta de tarifa
  renderPriceCardPlaceholder();

  // Auto-llenar datos del remitente
  const savedName = localStorage.getItem('calmovil_cliente_nombre') || '';
  const savedPhone = localStorage.getItem('calmovil_cliente_telefono') || '';
  const nameInput = document.getElementById('pkRemitenteNombre');
  const phoneInput = document.getElementById('pkRemitenteTelefono');
  if (nameInput && savedName) nameInput.value = savedName;
  if (phoneInput && savedPhone) phoneInput.value = savedPhone;
}

function closePaqueteForm() {
  const formModal = document.getElementById('paqueteFormModal');
  if (formModal) formModal.style.display = 'none';
  document.getElementById('paqueteFormEl')?.reset();
  const preview = document.getElementById('pkFotoPreview');
  if (preview) preview.style.display = 'none';
  openPaqueteriaPanel();
}

/* ══════════════════════════════════════
   AUTOCOMPLETADO DE DIRECCIONES (Nominatim)
   ══════════════════════════════════════ */
function setupAddressAutocomplete(inputId, suggId, onSelectCoords) {
  const input = document.getElementById(inputId);
  const sugg = document.getElementById(suggId);
  if (!input || !sugg) return;

  input.addEventListener('focus', () => {
    if (!input.value.trim()) {
      showEmptyAddressSugg(sugg, input, onSelectCoords);
    }
  });

  input.addEventListener('input', () => {
    const q = input.value.trim();
    input.classList.remove('pk-addr-ok');
    clearTimeout(_suggTimers[inputId]);

    if (q.length < 3) {
      if (q.length === 0) {
        showEmptyAddressSugg(sugg, input, onSelectCoords);
      } else {
        sugg.style.display = 'none';
      }
      return;
    }

    _suggTimers[inputId] = setTimeout(() => {
      fetchAddressSuggestions(q, sugg, input, onSelectCoords);
    }, 400);
  });
}

function showEmptyAddressSugg(sugg, input, onSelectCoords) {
  sugg.innerHTML = `
    <div class="pk-sugg-item" id="pkUseGpsBtn">
      <span>🎯</span>
      <div>
        <span class="pk-sugg-main">Usar mi ubicación actual</span>
        <span class="pk-sugg-sub">Detectar vía GPS</span>
      </div>
    </div>
  `;
  sugg.style.display = 'block';

  sugg.querySelector('#pkUseGpsBtn')?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización');
      return;
    }
    input.value = '📡 Obteniendo GPS...';
    sugg.style.display = 'none';

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
          const d = await res.json();
          const addr = d.address || {};
          const label = addr.road
            ? `${addr.road}${addr.house_number ? ' #' + addr.house_number : ''}${addr.suburb ? ', ' + addr.suburb : ''}`
            : (d.display_name.split(',')[0] || 'Mi ubicación actual');
          input.value = label;
          input.classList.add('pk-addr-ok');
          onSelectCoords({ lat, lng, name: label });
        } catch {
          input.value = 'Mi ubicación actual';
          input.classList.add('pk-addr-ok');
          onSelectCoords({ lat, lng, name: 'Mi ubicación actual' });
        }
      },
      () => {
        alert('Por favor concede permisos de ubicación en tu navegador.');
        input.value = '';
      },
      { enableHighAccuracy: true, timeout: 9000 }
    );
  });
}

async function fetchAddressSuggestions(q, sugg, input, onSelectCoords) {
  try {
    const base = 'https://nominatim.openstreetmap.org/search';
    const params = `format=json&limit=5&countrycodes=co&addressdetails=1&viewbox=${VIEWBOX}&bounded=1`;
    let res = await fetch(`${base}?q=${encodeURIComponent(q)}&${params}`);
    let data = await res.json();

    if (!data.length) {
      // Fallback sin bounded agregando Bogotá / Cundinamarca
      res = await fetch(`${base}?q=${encodeURIComponent(q + ' Bogota Cundinamarca')}&format=json&limit=5&countrycodes=co&addressdetails=1`);
      data = await res.json();
    }

    if (!data.length) {
      sugg.innerHTML = `<div class="pk-sugg-item muted"><span>🔍</span> Sin resultados — intenta con otro nombre</div>`;
      sugg.style.display = 'block';
      return;
    }

    sugg.innerHTML = data.map((d, idx) => {
      const a = d.address || {};
      const main = d.name || a.road || a.neighbourhood || a.suburb || d.display_name.split(',')[0];
      const sub = [a.municipality || a.city || a.town, a.state].filter(Boolean).join(', ') || d.display_name.split(',').slice(1, 3).join(',');
      return `
        <div class="pk-sugg-item" data-idx="${idx}">
          <span>📍</span>
          <div>
            <span class="pk-sugg-main">${main.slice(0, 50)}</span>
            <span class="pk-sugg-sub">${sub.slice(0, 55)}</span>
          </div>
        </div>
      `;
    }).join('');
    sugg.style.display = 'block';

    sugg.querySelectorAll('.pk-sugg-item[data-idx]').forEach((item) => {
      item.addEventListener('click', () => {
        const d = data[parseInt(item.dataset.idx, 10)];
        const a = d.address || {};
        const shortName = d.name || a.road || d.display_name.split(',')[0];
        input.value = shortName;
        input.classList.add('pk-addr-ok');
        sugg.style.display = 'none';
        onSelectCoords({
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
          name: shortName,
        });
      });
    });
  } catch (err) {
    console.warn('[Paquetería] Error geocodificando:', err);
  }
}

/* ══════════════════════════════════════
   CÁLCULO DE TARIFA Y RUTA
   ══════════════════════════════════════ */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function recalcularTarifaPaquete() {
  const priceCard = document.getElementById('pkPriceCard');
  if (!priceCard) return;

  if (!_origenCoords || !_destinoCoords) {
    renderPriceCardPlaceholder();
    return;
  }

  priceCard.innerHTML = `
    <div style="text-align:center;padding:12px;color:rgba(255,255,255,0.6);font-size:13px;">
      <span class="spinner" style="display:inline-block;border-width:2.5px;height:20px;width:20px;margin-bottom:6px;border-top-color:#30D158;"></span>
      <br>Calculando la mejor ruta y tarifa...
    </div>
  `;

  let distKm = 0;
  let durMins = 0;

  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${_origenCoords.lng},${_origenCoords.lat};${_destinoCoords.lng},${_destinoCoords.lat}?overview=false`;
    const res = await fetch(osrmUrl);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.[0]) {
      distKm = data.routes[0].distance / 1000;
      durMins = Math.round(data.routes[0].duration / 60);
    } else {
      throw new Error('OSRM no devolvió ruta');
    }
  } catch {
    // Fallback: Haversine + estimación de desvío 1.35x para calles
    distKm = haversineKm(_origenCoords.lat, _origenCoords.lng, _destinoCoords.lat, _destinoCoords.lng) * 1.35;
    durMins = Math.round(distKm * 2.8);
  }

  _currentDistanceKm = Math.max(0.5, Math.round(distKm * 10) / 10);
  _currentDurationMin = Math.max(3, durMins);

  // Fórmula ZIPPY base moto:
  const BASE_FARE = 2700;
  const PER_KM_FARE = 1000;
  const PER_MIN_FARE = 120;
  let priceBase = BASE_FARE + (_currentDistanceKm * PER_KM_FARE) + (_currentDurationMin * PER_MIN_FARE);
  priceBase = Math.round(priceBase / 100) * 100;
  priceBase = Math.max(4000, priceBase);
  priceBase = Math.round((priceBase * 1.03) + 500) - 600;
  priceBase = Math.max(4000, priceBase);

  // Recargo por tamaño
  const tamanoRadio = document.querySelector('input[name="pkTamano"]:checked');
  const tamano = tamanoRadio ? tamanoRadio.value : 'pequeno';
  const recargos = { pequeno: 0, mediano: 1500, grande: 3000 };
  const recargo = recargos[tamano] ?? 0;

  // Tarifa final paquete (mínimo garantizado $5.000 COP)
  _currentTarifa = Math.max(5000, priceBase + recargo);
  _currentTarifa = Math.round(_currentTarifa / 100) * 100;

  // Renderizar tarjeta de precio atractiva
  const tamanoLabels = { pequeno: 'Pequeño (Sin recargo)', mediano: 'Mediano (+$1.500)', grande: 'Grande (+$3.000)' };
  priceCard.innerHTML = `
    <div class="pk-price-top">
      <div>
        <div class="pk-price-label">Tarifa Total del Envío</div>
        <div class="pk-price-route">📍 ${_currentDistanceKm.toFixed(1)} km · ~${_currentDurationMin} min</div>
      </div>
      <div class="pk-price-total">$${_currentTarifa.toLocaleString('es-CO')}</div>
    </div>
    <div class="pk-price-breakdown">
      <div><span>Tarifa trayecto moto:</span> <strong>$${priceBase.toLocaleString('es-CO')}</strong></div>
      <div><span>Recargo tamaño (${tamanoLabels[tamano]}):</span> <strong>${recargo > 0 ? '+$' + recargo.toLocaleString('es-CO') : '$0'}</strong></div>
    </div>
  `;

  updateSubmitButtonText();
}

function renderPriceCardPlaceholder() {
  const priceCard = document.getElementById('pkPriceCard');
  if (priceCard) {
    priceCard.innerHTML = `<div class="pk-price-placeholder">💰 Elige origen, destino y tamaño para ver la tarifa</div>`;
  }
  updateSubmitButtonText();
}

/* ══════════════════════════════════════
   SELECTOR DE PAGOS (Quién paga y Método)
   ══════════════════════════════════════ */
function setupPaymentSelectors() {
  const pagaGrid = document.getElementById('pkPagaGrid');
  const metodoGrid = document.getElementById('pkMetodoGrid');

  pagaGrid?.querySelectorAll('.pk-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      _selectedPaga = btn.dataset.paga;
      // Si paga el destinatario, solo puede ser en efectivo (no está en la app)
      if (_selectedPaga === 'destinatario') {
        _selectedMetodo = 'efectivo';
      }
      updatePaymentUI();
    });
  });

  metodoGrid?.querySelectorAll('.pk-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      _selectedMetodo = btn.dataset.metodo;
      updatePaymentUI();
    });
  });
}

function updatePaymentUI() {
  // Botones de quién paga
  document.querySelectorAll('#pkPagaGrid .pk-choice').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.paga === _selectedPaga);
  });

  // Botón Wompi se deshabilita si paga el destinatario
  const btnWompi = document.querySelector('#pkMetodoGrid .pk-choice[data-metodo="wompi"]');
  if (btnWompi) {
    if (_selectedPaga === 'destinatario') {
      btnWompi.disabled = true;
      btnWompi.title = 'El pago digital solo está disponible para quien envía.';
    } else {
      btnWompi.disabled = false;
      btnWompi.title = '';
    }
  }

  // Botones de método
  document.querySelectorAll('#pkMetodoGrid .pk-choice').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.metodo === _selectedMetodo);
  });

  // Nota explicativa
  const note = document.getElementById('pkPayNote');
  if (note) {
    if (_selectedMetodo === 'wompi') {
      note.innerHTML = `💳 Pagas <strong>$${(_currentTarifa || 0).toLocaleString('es-CO')}</strong> en línea con tarjeta, Nequi o PSE. El conductor no te cobrará nada.`;
    } else if (_selectedPaga === 'destinatario') {
      note.innerHTML = `💵 El conductor cobrará <strong>$${(_currentTarifa || 0).toLocaleString('es-CO')}</strong> en efectivo a la persona que recibe el paquete al entregarlo.`;
    } else {
      note.innerHTML = `💵 Pagas <strong>$${(_currentTarifa || 0).toLocaleString('es-CO')}</strong> en efectivo al conductor cuando llegue a recoger el paquete.`;
    }
  }

  updateSubmitButtonText();
}

function updateSubmitButtonText() {
  const submitBtn = document.getElementById('submitPaqueteBtn');
  if (!submitBtn) return;

  const precioTexto = _currentTarifa > 0 ? ` · $${_currentTarifa.toLocaleString('es-CO')}` : '';

  if (_selectedMetodo === 'wompi') {
    submitBtn.classList.add('wompi');
    submitBtn.innerHTML = `💳 Pagar y Enviar${precioTexto}`;
  } else {
    submitBtn.classList.remove('wompi');
    submitBtn.innerHTML = `📦 Enviar Paquete${precioTexto}`;
  }
}

/* ══════════════════════════════════════
   PREVIEW FOTO
   ══════════════════════════════════════ */
function handleFotoPreview(e) {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById('pkFotoPreview');
  if (!preview) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    preview.src = ev.target.result;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(file);

  const label = document.getElementById('pkFotoLabel');
  if (label) label.textContent = `📷 ${file.name.slice(0, 24)}...`;
}

/* ══════════════════════════════════════
   SUBMIT — Crear nuevo paquete
   ══════════════════════════════════════ */
async function handlePaqueteSubmit(e) {
  e.preventDefault();
  const userId = getUserId();
  if (!userId) {
    alert('Inicia sesión en ZIPPY para enviar un paquete.');
    return;
  }

  if (!_origenCoords || !_destinoCoords) {
    alert('Por favor selecciona la dirección de recogida y de entrega desde las opciones sugeridas.');
    return;
  }

  if (!_currentTarifa || _currentTarifa < 5000) {
    alert('Calculando la tarifa. Espera un momento o recalcula la ruta.');
    return;
  }

  const submitBtn = document.getElementById('submitPaqueteBtn');
  const originalText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '⏳ Procesando envío...';

  const origenTxt = document.getElementById('pkOrigen').value.trim();
  const origenDetalle = document.getElementById('pkOrigenDetalle')?.value.trim();
  const destinoTxt = document.getElementById('pkDestino').value.trim();
  const destinoDetalle = document.getElementById('pkDestinoDetalle')?.value.trim();

  const origenCompleto = origenDetalle ? `${origenTxt} (${origenDetalle})` : origenTxt;
  const destinoCompleto = destinoDetalle ? `${destinoTxt} (${destinoDetalle})` : destinoTxt;

  const remitenteNombre = document.getElementById('pkRemitenteNombre').value.trim();
  const remitenteTelefono = document.getElementById('pkRemitenteTelefono').value.trim();
  const destinatarioNombre = document.getElementById('pkDestinatarioNombre').value.trim();
  const destinatarioTelefono = document.getElementById('pkDestinatarioTelefono').value.trim();
  const tamano = document.querySelector('input[name="pkTamano"]:checked')?.value || 'pequeno';
  const descripcion = document.getElementById('pkDescripcion')?.value.trim() || '';

  // Subir foto opcional
  let fotoUrl = null;
  const fotoFile = document.getElementById('pkFotoInput')?.files[0];
  if (fotoFile) {
    try {
      const ext = fotoFile.name.split('.').pop();
      const path = `paquetes/${userId}/${Date.now()}.${ext}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('paquetes-fotos')
        .upload(path, fotoFile, { upsert: true });
      if (!uploadError && uploadData) {
        const { data: urlData } = supabase.storage.from('paquetes-fotos').getPublicUrl(path);
        fotoUrl = urlData?.publicUrl || null;
      }
    } catch (err) {
      console.warn('[Paquetería] Error subiendo foto:', err);
    }
  }

  const codigo = 'PKT-' + generateRideCode();
  const esWompi = _selectedMetodo === 'wompi';
  const estadoInicial = esWompi ? 'esperando_pago' : 'pendiente';

  // 1) Guardar el registro en Supabase
  const { data: inserted, error: insertError } = await supabase
    .from('paquetes')
    .insert({
      pasajero_id: userId,
      codigo_paquete: codigo,
      origen: origenCompleto,
      destino: destinoCompleto,
      origen_lat: _origenCoords.lat,
      origen_lng: _origenCoords.lng,
      destino_lat: _destinoCoords.lat,
      destino_lng: _destinoCoords.lng,
      distancia_km: _currentDistanceKm,
      duracion_min: _currentDurationMin,
      remitente_nombre: remitenteNombre,
      remitente_telefono: remitenteTelefono,
      destinatario_nombre: destinatarioNombre,
      destinatario_telefono: destinatarioTelefono,
      tamano,
      descripcion,
      foto_url: fotoUrl,
      tarifa: _currentTarifa,
      metodo_pago: _selectedMetodo,
      paga: _selectedPaga,
      pagado: false,
      estado: estadoInicial,
    })
    .select('id, codigo_paquete, tarifa')
    .single();

  submitBtn.disabled = false;
  submitBtn.innerHTML = originalText;

  if (insertError) {
    alert('❌ Error al crear el envío: ' + insertError.message);
    return;
  }

  // 2) Si es Wompi: abrir pasarela
  if (esWompi && inserted) {
    closeFormClean();
    openPaqueteriaPanel();
    iniciarPagoWompiPaquete(inserted.id, codigo, _currentTarifa);
    return;
  }

  // 3) Si es Efectivo: Éxito inmediato
  closeFormClean();
  showToast(`✅ ¡Envío ${codigo} solicitado! Buscando conductor...`);
  openPaqueteriaPanel();
}

function closeFormClean() {
  const formModal = document.getElementById('paqueteFormModal');
  if (formModal) formModal.style.display = 'none';
  document.getElementById('paqueteFormEl')?.reset();
  const preview = document.getElementById('pkFotoPreview');
  if (preview) preview.style.display = 'none';
  document.getElementById('pkOrigen')?.classList.remove('pk-addr-ok');
  document.getElementById('pkDestino')?.classList.remove('pk-addr-ok');
}

/* ══════════════════════════════════════
   PAGOS CON WOMPI (Con Fallback Seguro)
   ══════════════════════════════════════ */
async function iniciarPagoWompiPaquete(paqueteId, codigoPaquete, tarifa) {
  if (typeof WidgetCheckout !== 'function') {
    alert('El sistema de pagos de Wompi aún no está listo. Intenta de nuevo en unos segundos.');
    return;
  }

  const cents = Math.round(tarifa * 100);
  let reference = `PKG-${codigoPaquete}-${Date.now()}`;
  let signature = null;
  let publicKey = WOMPI_PUB_KEY;

  // Intentar primero con la Edge Function del servidor (máxima seguridad)
  try {
    const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('paquete-wompi-firma', {
      body: { paquete_id: paqueteId },
    });
    if (!edgeErr && edgeData?.signature) {
      reference = edgeData.reference;
      signature = edgeData.signature;
      publicKey = edgeData.publicKey || WOMPI_PUB_KEY;
    }
  } catch (err) {
    console.warn('[Paquetería] Edge function de firma no disponible, usando fallback:', err);
  }

  // Fallback seguro en frontend si la Edge Function no estaba desplegada
  if (!signature) {
    const msg = reference + cents + 'COP' + WOMPI_INTEGRITY_SECRET;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
    signature = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

    // Actualizar referencia en la base de datos
    await supabase.from('paquetes').update({
      wompi_referencia: reference,
      wompi_estado: 'INICIADO',
    }).eq('id', paqueteId);
  }

  const checkout = new WidgetCheckout({
    currency: 'COP',
    amountInCents: cents,
    reference: reference,
    publicKey: publicKey,
    signature: { integrity: signature },
  });

  checkout.open(async (result) => {
    const tx = result?.transaction;
    if (tx?.status === 'APPROVED') {
      // Confirmar en la BD
      await supabase.from('paquetes').update({
        pagado: true,
        estado: 'pendiente', // Ahora sí es visible para los conductores
        wompi_estado: 'APPROVED',
        wompi_transaccion_id: tx.id || null,
      }).eq('id', paqueteId);

      showToast(`🎉 ¡Pago de $${tarifa.toLocaleString('es-CO')} APROBADO! Buscando conductor...`, '#30D158');
      loadPaquetes();
    } else {
      showToast('⚠️ El pago no se completó. Puedes reintentar cuando quieras.', '#FF9500');
      loadPaquetes();
    }
  });
}

/* ══════════════════════════════════════
   CARGAR PAQUETES DEL USUARIO
   ══════════════════════════════════════ */
async function loadPaquetes() {
  const userId = getUserId();
  if (!userId) return;

  const container = document.getElementById('paquetesListContainer');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.4);font-size:14px;">
      <span class="spinner" style="display:inline-block;border-width:3px;height:28px;width:28px;margin-bottom:14px;border-top-color:#FF6B00;"></span>
      <br>Cargando envíos...
    </div>
  `;

  const { data, error } = await supabase
    .from('paquetes')
    .select('*')
    .eq('pasajero_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    container.innerHTML = `<div style="text-align:center;padding:30px 20px;color:#FF3B30;font-size:14px;">⚠️ Error cargando envíos</div>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `
      <div class="paquetes-empty">
        <div class="paquetes-empty-icon">📦</div>
        <div class="paquetes-empty-text">No tienes envíos aún</div>
        <div class="paquetes-empty-sub">¡Envía tu primer paquete con ZIPPY!</div>
      </div>
    `;
    return;
  }

  container.innerHTML = data.map(renderPaqueteCard).join('');

  // Vincular botones de pago pendiente y acciones
  data.forEach((p) => {
    if (p.estado === 'esperando_pago') {
      document.getElementById(`payPendingBtn-${p.id}`)?.addEventListener('click', () => {
        iniciarPagoWompiPaquete(p.id, p.codigo_paquete, Number(p.tarifa || 0));
      });

      document.getElementById(`switchEfectivoBtn-${p.id}`)?.addEventListener('click', async () => {
        const { error: updErr } = await supabase
          .from('paquetes')
          .update({ metodo_pago: 'efectivo', estado: 'pendiente' })
          .eq('id', p.id);
        if (updErr) {
          alert('Error cambiando a efectivo: ' + updErr.message);
        } else {
          showToast('💵 Cambiado a efectivo. Buscando conductor...');
          loadPaquetes();
        }
      });

      document.getElementById(`cancelPendingBtn-${p.id}`)?.addEventListener('click', async () => {
        if (!confirm('¿Deseas cancelar esta solicitud de envío?')) return;
        await supabase.from('paquetes').update({ estado: 'cancelado' }).eq('id', p.id);
        loadPaquetes();
      });
    }
  });
}

/* ══════════════════════════════════════
   RENDER CARD USUARIO
   ══════════════════════════════════════ */
function getStatusBadge(estado) {
  const badges = {
    esperando_pago: { label: 'Esperando Pago', color: '#FF9500', bg: 'rgba(255,149,0,0.15)', emoji: '⏳' },
    pendiente:      { label: 'Buscando Conductor', color: '#FF9500', bg: 'rgba(255,149,0,0.15)', emoji: '🟡' },
    aceptado:       { label: 'Conductor Asignado', color: '#3498DB', bg: 'rgba(52,152,219,0.15)', emoji: '🔵' },
    recogido:       { label: 'En Camino',  color: '#5856D6', bg: 'rgba(88,86,214,0.15)', emoji: '🚗' },
    entregado:      { label: 'Entregado',  color: '#30D158', bg: 'rgba(48,209,88,0.15)', emoji: '✅' },
    cancelado:      { label: 'Cancelado',  color: '#FF3B30', bg: 'rgba(255,59,48,0.15)', emoji: '❌' },
  };
  return badges[estado] || badges.pendiente;
}

function getTamanoLabel(tamano) {
  const labels = {
    pequeno: '📦 Pequeño',
    mediano: '📫 Mediano',
    grande:  '🗃️ Grande',
  };
  return labels[tamano] || tamano || '—';
}

function renderPaqueteCard(p) {
  const badge = getStatusBadge(p.estado);
  const fecha = new Date(p.created_at).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const tarifaNum = Number(p.tarifa || 0);

  // Chip de pago
  let chipPagoHtml = '';
  if (p.metodo_pago === 'wompi') {
    if (p.pagado) {
      chipPagoHtml = `<span class="paquete-pay-chip ok">💳 Wompi Pagado</span>`;
    } else {
      chipPagoHtml = `<span class="paquete-pay-chip" style="color:#FF9500;border-color:rgba(255,149,0,0.3);">💳 Wompi Pendiente</span>`;
    }
  } else {
    const pagaQuien = p.paga === 'destinatario' ? 'Paga quien recibe' : 'Pagas al enviar';
    chipPagoHtml = `<span class="paquete-pay-chip">💵 Efectivo (${pagaQuien})</span>`;
  }

  // Caja de acción si está esperando pago
  let pendingActionsHtml = '';
  if (p.estado === 'esperando_pago') {
    pendingActionsHtml = `
      <div class="paquete-pending-box">
        <div class="paquete-pending-text">⚠️ Pago pendiente por $${tarifaNum.toLocaleString('es-CO')}</div>
        <div class="paquete-pending-actions">
          <button class="pay" id="payPendingBtn-${p.id}">💳 Pagar con Wompi</button>
          <button id="switchEfectivoBtn-${p.id}">💵 Pagar en Efectivo</button>
          <button class="cancel" id="cancelPendingBtn-${p.id}">✕ Cancelar</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="paquete-card">
      <div class="paquete-card-header">
        <div>
          <div class="paquete-codigo">📬 ${p.codigo_paquete || '---'}</div>
          <div class="paquete-fecha">${fecha}</div>
        </div>
        <div class="paquete-badge" style="color:${badge.color};background:${badge.bg};">
          ${badge.emoji} ${badge.label}
        </div>
      </div>

      <div class="paquete-ruta">
        <div class="paquete-ruta-item">
          <span class="paquete-ruta-dot" style="background:#30D158;"></span>
          <span>${p.origen || '—'}</span>
        </div>
        <div class="paquete-ruta-item">
          <span class="paquete-ruta-dot" style="background:#FF6B00;"></span>
          <span>${p.destino || '—'}</span>
        </div>
      </div>

      <div class="paquete-info-row">
        <span>👤 <strong>Para:</strong> ${p.destinatario_nombre || '—'} · ${p.destinatario_telefono || '—'}</span>
        <span>${getTamanoLabel(p.tamano)}</span>
      </div>

      ${p.descripcion ? `<div style="font-size:11.5px;color:rgba(255,255,255,0.4);font-style:italic;">"${p.descripcion}"</div>` : ''}

      <div class="paquete-pay-row">
        ${chipPagoHtml}
        <div class="paquete-tarifa">$${tarifaNum.toLocaleString('es-CO')}</div>
      </div>

      ${pendingActionsHtml}
    </div>
  `;
}

/* ══════════════════════════════════════
   TOAST HELPER
   ══════════════════════════════════════ */
function showToast(msg, color = 'rgba(48,209,88,0.95)') {
  const toast = document.createElement('div');
  toast.style.cssText = [
    'position:fixed;top:80px;left:50%;transform:translateX(-50%);',
    `background:${color};color:#fff;padding:14px 24px;`,
    'border-radius:16px;font-weight:800;font-size:14px;z-index:999999;',
    'animation:slideUp 0.3s ease;white-space:nowrap;',
    'box-shadow:0 6px 24px rgba(0,0,0,0.4);font-family:Inter,sans-serif;',
  ].join('');
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
