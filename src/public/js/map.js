/**
 * Google Maps - Funciones compartidas para dashboard y detalle de viaje
 *
 * Funcionalidades:
 *  - Marcadores con iconos SVG por estado (en_ruta, en_espera, cargando, alerta)
 *  - InfoWindow con detalle de viaje y enlace
 *  - Ruta polyline para detalle de viaje
 *  - Ajuste automatico de bounds
 *  - Animacion suave de marcadores
 */

var map = null;
var markers = [];
var infoWindow = null;

// ---------------------------------------------------------------------------
// Colores por estado
// ---------------------------------------------------------------------------

var STATE_COLORS = {
  en_ruta:   { fill: '#16a34a', stroke: '#15803d', label: 'En Ruta' },
  en_espera: { fill: '#d97706', stroke: '#b45309', label: 'En Espera' },
  cargando:  { fill: '#4f46e5', stroke: '#4338ca', label: 'Cargando' },
  alerta:    { fill: '#dc2626', stroke: '#b91c1c', label: 'Alerta' },
  default:   { fill: '#6b7280', stroke: '#4b5563', label: 'Desconocido' },
};

// ---------------------------------------------------------------------------
// Crear icono SVG como marcador
// ---------------------------------------------------------------------------

function createMarkerIcon(estado, isAlert) {
  var colors = isAlert ? STATE_COLORS.alerta : (STATE_COLORS[estado] || STATE_COLORS.default);

  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">' +
    '<defs><filter id="shadow" x="-20%" y="-10%" width="140%" height="140%">' +
    '<feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.3"/></filter></defs>' +
    '<path d="M16 0C7.164 0 0 7.164 0 16c0 10 16 26 16 26s16-16 16-26C32 7.164 24.836 0 16 0z" ' +
    'fill="' + colors.fill + '" stroke="' + colors.stroke + '" stroke-width="1" filter="url(#shadow)"/>' +
    '<circle cx="16" cy="15" r="7" fill="white" opacity="0.9"/>' +
    (isAlert
      ? '<text x="16" y="19" text-anchor="middle" font-size="12" font-weight="bold" fill="' + colors.fill + '">!</text>'
      : (estado === 'en_ruta'
        ? '<polygon points="13,11 21,15 13,19" fill="' + colors.fill + '"/>'
        : (estado === 'cargando'
          ? '<rect x="12" y="11" width="8" height="8" rx="1" fill="' + colors.fill + '"/>'
          : '<circle cx="16" cy="15" r="4" fill="' + colors.fill + '"/>'
        )
      )
    ) +
    '</svg>';

  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(32, 42),
    anchor: new google.maps.Point(16, 42),
    labelOrigin: new google.maps.Point(16, 15),
  };
}

// ---------------------------------------------------------------------------
// Crear marcador de posicion actual (pulso azul)
// ---------------------------------------------------------------------------

function createCurrentPositionIcon() {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="10" fill="#3b82f6" opacity="0.2">' +
    '<animate attributeName="r" from="6" to="12" dur="1.5s" repeatCount="indefinite"/>' +
    '<animate attributeName="opacity" from="0.4" to="0" dur="1.5s" repeatCount="indefinite"/>' +
    '</circle>' +
    '<circle cx="12" cy="12" r="6" fill="#2563eb" stroke="white" stroke-width="2"/>' +
    '</svg>';

  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(24, 24),
    anchor: new google.maps.Point(12, 12),
  };
}

// ---------------------------------------------------------------------------
// Estilos del mapa (limpio, sin POIs ni transito)
// ---------------------------------------------------------------------------

var MAP_STYLES = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#dbeafe' }] },
  { featureType: 'landscape.natural', elementType: 'geometry.fill', stylers: [{ color: '#f0fdf4' }] },
];

// ---------------------------------------------------------------------------
// Inicializar mapa del dashboard
// ---------------------------------------------------------------------------

function initMap() {
  var mapEl = document.getElementById('map');
  if (!mapEl) return;

  // Centro de Mexico por defecto
  map = new google.maps.Map(mapEl, {
    center: { lat: 23.6345, lng: -102.5528 },
    zoom: 5,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.RIGHT_CENTER,
    },
    styles: MAP_STYLES,
    gestureHandling: 'cooperative',
  });

  infoWindow = new google.maps.InfoWindow();

  // Agregar marcadores de viajes activos
  if (typeof viajesData !== 'undefined' && Array.isArray(viajesData)) {
    addViajeMarkers(viajesData);
  }
}

// ---------------------------------------------------------------------------
// Inicializar mapa de detalle de viaje
// ---------------------------------------------------------------------------

function initDetailMap() {
  var mapEl = document.getElementById('detail-map');
  if (!mapEl) return;

  map = new google.maps.Map(mapEl, {
    center: { lat: 23.6345, lng: -102.5528 },
    zoom: 6,
    mapTypeControl: true,
    streetViewControl: false,
    styles: MAP_STYLES,
  });

  infoWindow = new google.maps.InfoWindow();

  // Dibujar ruta con coordenadas
  if (typeof coordsData !== 'undefined' && Array.isArray(coordsData) && coordsData.length > 0) {
    drawRoute(coordsData);
  }

  // Marcador de posicion actual del viaje
  if (typeof viajeData !== 'undefined' && viajeData.ultima_lat && viajeData.ultima_lng) {
    var pos = { lat: parseFloat(viajeData.ultima_lat), lng: parseFloat(viajeData.ultima_lng) };
    var marker = new google.maps.Marker({
      position: pos,
      map: map,
      title: 'Posicion actual',
      icon: createCurrentPositionIcon(),
      zIndex: 999,
    });
    map.setCenter(pos);
    map.setZoom(10);
  }
}

// ---------------------------------------------------------------------------
// Agregar marcadores de viajes al mapa
// ---------------------------------------------------------------------------

function addViajeMarkers(viajes) {
  clearMarkers();

  if (!map || !viajes || viajes.length === 0) return;

  var bounds = new google.maps.LatLngBounds();
  var hasMarkers = false;

  // Determinar viajes en alerta (paro detectado)
  var alertIds = {};
  if (typeof alertaViajesData !== 'undefined' && Array.isArray(alertaViajesData)) {
    alertaViajesData.forEach(function(a) { alertIds[a.id] = true; });
  }

  viajes.forEach(function(viaje) {
    if (!viaje.ultima_lat || !viaje.ultima_lng) return;

    var lat = parseFloat(viaje.ultima_lat);
    var lng = parseFloat(viaje.ultima_lng);
    if (isNaN(lat) || isNaN(lng)) return;

    var pos = { lat: lat, lng: lng };
    var isAlert = !!alertIds[viaje.id];

    var marker = new google.maps.Marker({
      position: pos,
      map: map,
      title: viaje.numero_economico || ('Viaje #' + viaje.id),
      icon: createMarkerIcon(viaje.estado_actual, isAlert),
      animation: google.maps.Animation.DROP,
      zIndex: isAlert ? 100 : 10,
    });

    // Guardar referencia al viaje en el marcador
    marker._viajeId = viaje.id;

    // InfoWindow al hacer clic
    marker.addListener('click', function() {
      var stateColors = STATE_COLORS[viaje.estado_actual] || STATE_COLORS.default;
      var stateLabel = stateColors.label;

      var content =
        '<div style="font-family:Inter,system-ui,sans-serif;min-width:220px;padding:4px">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + stateColors.fill + '"></span>' +
        '<strong style="font-size:14px;color:#111827">' + (viaje.numero_economico || 'Viaje #' + viaje.id) + '</strong>' +
        '</div>' +
        '<div style="background:#f9fafb;border-radius:6px;padding:8px;margin-bottom:8px">' +
        '<div style="font-size:12px;color:#6b7280;margin-bottom:4px">' +
        '<strong style="color:#374151">Origen:</strong> ' + (viaje.origen || '—') +
        '</div>' +
        '<div style="font-size:12px;color:#6b7280">' +
        '<strong style="color:#374151">Destino:</strong> ' + (viaje.destino || '—') +
        '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:500;background:' + stateColors.fill + '15;color:' + stateColors.fill + '">' +
        stateLabel + '</span>' +
        '<a href="/viajes/' + viaje.id + '" style="color:#2563eb;font-size:12px;font-weight:500;text-decoration:none">Ver detalle →</a>' +
        '</div>';

      if (isAlert) {
        content += '<div style="margin-top:8px;padding:6px 8px;background:#fef2f2;border-radius:6px;font-size:11px;color:#dc2626;font-weight:500">' +
          '⚠ Paro detectado — sin movimiento por más del umbral</div>';
      }

      content += '</div>';

      infoWindow.setContent(content);
      infoWindow.open(map, marker);
    });

    markers.push(marker);
    bounds.extend(pos);
    hasMarkers = true;
  });

  if (hasMarkers) {
    map.fitBounds(bounds);
    // No hacer zoom demasiado si hay pocos marcadores
    google.maps.event.addListenerOnce(map, 'bounds_changed', function() {
      if (map.getZoom() > 14) map.setZoom(14);
    });
  }
}

// ---------------------------------------------------------------------------
// Dibujar ruta de viaje en el mapa (detalle)
// ---------------------------------------------------------------------------

function drawRoute(coords) {
  var path = coords.map(function(c) {
    return { lat: parseFloat(c.latitud), lng: parseFloat(c.longitud) };
  }).filter(function(p) {
    return !isNaN(p.lat) && !isNaN(p.lng);
  });

  if (path.length === 0) return;

  // Linea principal
  var polyline = new google.maps.Polyline({
    path: path,
    geodesic: true,
    strokeColor: '#2563eb',
    strokeOpacity: 0.8,
    strokeWeight: 3,
  });
  polyline.setMap(map);

  // Linea de sombra (efecto profundidad)
  var shadow = new google.maps.Polyline({
    path: path,
    geodesic: true,
    strokeColor: '#1e40af',
    strokeOpacity: 0.15,
    strokeWeight: 8,
  });
  shadow.setMap(map);

  // Marcador de inicio
  if (path.length > 0) {
    new google.maps.Marker({
      position: path[0],
      map: map,
      title: 'Inicio',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: '#16a34a',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
      zIndex: 50,
    });
  }

  // Ajustar vista
  var bounds = new google.maps.LatLngBounds();
  path.forEach(function(p) { bounds.extend(p); });
  map.fitBounds(bounds);
}

// ---------------------------------------------------------------------------
// Limpiar marcadores
// ---------------------------------------------------------------------------

function clearMarkers() {
  markers.forEach(function(m) { m.setMap(null); });
  markers = [];
  if (infoWindow) infoWindow.close();
}

// ---------------------------------------------------------------------------
// Refrescar mapa (recarga pagina - fallback)
// ---------------------------------------------------------------------------

function refreshMap() {
  window.location.reload();
}
