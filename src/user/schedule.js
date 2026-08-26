/**
 * Scheduled Ride flow — date/time, map selection, fare, Wompi payment.
 */
import { supabase } from '../config/supabase.js';
import { createMap, pinIcon, LA_CALERA, COVERAGE_POLYGON, isPointInPolygon } from '../utils/map.js';
import { generateRideCode } from '../utils/id.js';
import { zippyAlert, zippyToast } from '../utils/ui-global.js';
import L from 'leaflet';

const BASE_FARE = 2700, PER_KM = 1000, PER_MIN = 120, MIN_FARE = 3400;

function haversineKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

function calcFare(distKm) {
  const mins = Math.round((distKm/22)*60)||1;
  let p = BASE_FARE + distKm*PER_KM + mins*PER_MIN;
  p = Math.round(p/100)*100; p = Math.max(MIN_FARE,p);
  p = Math.round((p*1.03)+500)-600;
  return Math.max(4000,p);
}

async function initWompiSchedule(agendadoId, tarifa, codigo) {
  if (typeof WidgetCheckout !== 'function') { zippyAlert('El sistema de pagos no cargó. Intenta de nuevo.','⚠️'); return false; }
  const currency='COP', cents=tarifa*100, reference=ZIPPY_SCHED__;
  const secret='prod_integrity_lImL3CgFSTzGzBcs661J1WF9UFJdHuZC';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(reference+cents+currency+secret));
  const hex = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  return new Promise(resolve=>{
    const co = new WidgetCheckout({ currency, amountInCents:cents, reference, publicKey:'pub_prod_SxZqnd7Fi3WqOdXDFGrDg0qNP0rMFtE4', signature:{integrity:hex} });
    co.open(async result=>{
      if (result.transaction?.status==='APPROVED') {
        await supabase.from('viajes_agendados').update({pagado:true}).eq('id',agendadoId);
        resolve(true);
      } else { zippyAlert('Pago no completado. Intenta de nuevo.','❌'); resolve(false); }
    });
  });
}

const VIEWBOX='-74.20,5.05,-73.75,4.55';
let geocodeTimers={};
async function geocode(query,type,onResult){
  try{
    const url=https://nominatim.openstreetmap.org/search?q=&format=json&limit=5&viewbox=&bounded=1&accept-language=es;
    const data=await (await fetch(url,{headers:{'Accept-Language':'es'}})).json();
    const el=document.getElementById(type+'Sugg');
    if(!el||!data.length){if(el)el.style.display='none';return;}
    el.innerHTML=data.slice(0,5).map(r=>{
      const label=r.display_name.split(',').slice(0,3).join(', ');
      return <div class="sched-sugg-item" data-lat="" data-lng="" data-label=""></div>;
    }).join('');
    el.style.display='block';
    el.querySelectorAll('.sched-sugg-item').forEach(it=>it.addEventListener('click',()=>{
      onResult(parseFloat(it.dataset.lat),parseFloat(it.dataset.lng),it.dataset.label);
      el.style.display='none';
    }));
  }catch(_){}
}

const OS_APP_ID='d1912f76-c166-43c4-b85b-fc461630445d';
const OS_API_KEY='os_v2_app_2gis65wbmzb4joc37rdbmmcel'+'xug4hx325fer4mvulla5n2oft3hcnl7mftyfyqubquicrhjd7z3222henni5ofkxpaj5hnemcbgzoa';

async function notifyDrivers(tarifa, fechaHora) {
  const fechaStr = new Date(fechaHora).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'});
  try{await fetch('https://api.onesignal.com/notifications',{method:'POST',headers:{'Content-Type':'application/json','Authorization':Key },body:JSON.stringify({app_id:OS_APP_ID,included_segments:['Total Subscriptions'],headings:{en:'📅 ¡Viaje Agendado ZIPPY!',es:'📅 ¡Viaje Agendado ZIPPY!'},contents:{en:$ | ,es:$ | },url:'https://appzippy.com/conductor/',chrome_web_icon:'https://appzippy.com/icons/icon-192x192.png'})});}catch(_){}
}

document.addEventListener('DOMContentLoaded', async()=>{
  const {data:{user}} = await supabase.auth.getUser();
  const map = createMap('schedMap', LA_CALERA, 14);
  const iconA=pinIcon('#30D158','A'), iconB=pinIcon('#FF6B00','B');
  const state={startLatLng:null,startMarker:null,startName:'',endLatLng:null,endMarker:null,endName:'',mapTarget:null,fare:0,routeLine:null};

  map.on('click',async e=>{
    if(!state.mapTarget)return;
    const {lat,lng}=e.latlng;
    if(!isPointInPolygon({lat,lng},COVERAGE_POLYGON)){zippyToast('📍 Ese punto está fuera de cobertura.');return;}
    let label=${lat.toFixed(5)}, ;
    try{const d=await(await fetch(https://nominatim.openstreetmap.org/reverse?lat=&lon=&format=json&accept-language=es)).json();if(d.display_name)label=d.display_name.split(',').slice(0,3).join(', ');}catch(_){}
    setPoint(state.mapTarget,lat,lng,label);
    state.mapTarget=null;
    document.getElementById('mapHint').style.display='none';
  });

  function setPoint(type,lat,lng,label){
    if(type==='start'){
      if(state.startMarker)map.removeLayer(state.startMarker);
      state.startLatLng=L.latLng(lat,lng); state.startName=label;
      state.startMarker=L.marker([lat,lng],{icon:iconA}).addTo(map);
      document.getElementById('startInput').value=label;
      document.getElementById('startSugg').style.display='none';
    }else{
      if(state.endMarker)map.removeLayer(state.endMarker);
      state.endLatLng=L.latLng(lat,lng); state.endName=label;
      state.endMarker=L.marker([lat,lng],{icon:iconB}).addTo(map);
      document.getElementById('endInput').value=label;
      document.getElementById('endSugg').style.display='none';
    }
    map.panTo([lat,lng]); tryCalcFare();
  }

  function tryCalcFare(){
    if(!(state.startLatLng&&state.endLatLng))return;
    const dk=haversineKm(state.startLatLng,state.endLatLng)*1.3;
    state.fare=calcFare(dk);
    const fe=document.getElementById('fareValue'), fs=document.getElementById('fareSection');
    if(fe)fe.textContent='$'+state.fare.toLocaleString('es-CO');
    if(fs)fs.style.display='block';
    if(state.routeLine)map.removeLayer(state.routeLine);
    fetch(https://router.project-osrm.org/route/v1/driving/,;,?overview=full&geometries=geojson)
      .then(r=>r.json()).then(data=>{
        if(data.code!=='Ok')return;
        const coords=data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
        state.routeLine=L.featureGroup([L.polyline(coords,{color:'#000',weight:15,opacity:0.4}),L.polyline(coords,{color:'#FF6B00',weight:8,opacity:1})]).addTo(map);
        map.fitBounds(L.latLngBounds([state.startLatLng,state.endLatLng]).pad(0.3));
      }).catch(()=>{state.routeLine=L.polyline([state.startLatLng,state.endLatLng],{color:'#FF6B00',weight:4}).addTo(map);});
  }

  ['start','end'].forEach(type=>{
    const input=document.getElementById(type+'Input');
    if(!input)return;
    input.addEventListener('input',()=>{
      const val=input.value.trim(); clearTimeout(geocodeTimers[type]);
      if(val.length<3){document.getElementById(type+'Sugg').style.display='none';return;}
      geocodeTimers[type]=setTimeout(()=>geocode(val,type,(lat,lng,label)=>setPoint(type,lat,lng,label)),420);
    });
    input.addEventListener('focus',()=>{
      const sugg=document.getElementById(type+'Sugg');
      sugg.innerHTML=<div class="sched-sugg-item" id="tapMap">📍 Tocar en el mapa</div>;
      sugg.style.display='block';
      document.getElementById('tapMap'+type)?.addEventListener('click',()=>{
        state.mapTarget=type; sugg.style.display='none';
        const h=document.getElementById('mapHint');
        h.textContent=type==='start'?'📍 Toca el mapa para marcar la recogida':'📍 Toca el mapa para marcar el destino';
        h.style.display='block';
      });
      if(type==='start'){document.getElementById('useGPS')?.addEventListener('click',()=>{sugg.style.display='none';navigator.geolocation?.getCurrentPosition(p=>setPoint('start',p.coords.latitude,p.coords.longitude,'Mi ubicación actual'),()=>zippyToast('⚠️ No se pudo obtener tu ubicación.'));});}
    });
  });

  document.addEventListener('click',e=>{
    ['start','end'].forEach(t=>{const s=document.getElementById(t+'Sugg'),i=document.getElementById(t+'Input');if(s&&!s.contains(e.target)&&e.target!==i)s.style.display='none';});
  });

  document.getElementById('confirmBtn')?.addEventListener('click',async()=>{
    const fechaVal=document.getElementById('schedDate').value, horaVal=document.getElementById('schedTime').value;
    if(!fechaVal||!horaVal){zippyAlert('Selecciona fecha y hora del viaje.','📅');return;}
    if(!state.startLatLng){zippyAlert('Marca el punto de recogida.','📍');return;}
    if(!state.endLatLng){zippyAlert('Marca el punto de destino.','🏁');return;}
    if(state.fare<=0){zippyAlert('No se calculó la tarifa. Intenta de nuevo.','⚠️');return;}
    const fechaHora=new Date(${fechaVal}T);
    if(fechaHora<=new Date()){zippyAlert('La fecha y hora deben ser en el futuro.','⏰');return;}
    const btn=document.getElementById('confirmBtn');
    btn.disabled=true; btn.textContent='Guardando...';
    const codigo=generateRideCode(), pasajeroId=user?.id||'anonimo_'+Date.now();
    const {data,error}=await supabase.from('viajes_agendados').insert({pasajero_id:pasajeroId,origen:state.startName,destino:state.endName,origen_lat:state.startLatLng.lat,origen_lng:state.startLatLng.lng,destino_lat:state.endLatLng.lat,destino_lng:state.endLatLng.lng,tarifa:state.fare,fecha_hora:fechaHora.toISOString(),estado:'pendiente',pagado:false,codigo_viaje:codigo,distancia_km:(haversineKm(state.startLatLng,state.endLatLng)*1.3).toFixed(1)}).select().single();
    if(error||!data){btn.disabled=false;btn.textContent='💳 Pagar y Agendar';zippyAlert('Error al guardar. Intenta de nuevo.','❌');return;}
    btn.textContent='Abriendo pago...';
    const paid=await initWompiSchedule(data.id,state.fare,codigo);
    if(paid){
      await notifyDrivers(state.fare,fechaHora.toISOString());
      document.getElementById('scheduleSheet').style.display='none';
      document.getElementById('successScreen').style.display='flex';
      document.getElementById('successCode').textContent=codigo;
      document.getElementById('successDate').textContent=fechaHora.toLocaleString('es-CO',{dateStyle:'full',timeStyle:'short'});
    }else{
      await supabase.from('viajes_agendados').delete().eq('id',data.id);
      btn.disabled=false; btn.textContent='💳 Pagar y Agendar';
    }
  });

  document.getElementById('goHomeBtn')?.addEventListener('click',()=>{window.location.href='/';});

  const di=document.getElementById('schedDate');
  if(di){di.min=new Date().toISOString().split('T')[0]; di.value=di.min;}
});
