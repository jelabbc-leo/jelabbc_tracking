/**
 * Viaje Detalle - Modulo frontend
 * Syncfusion Grids para coordenadas y eventos + auto-refresh + interaccion con mapa
 */

var ViajeDetailModule = (function() {
  'use strict';

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------
  var coordsGrid = null;
  var eventsGrid = null;
  var autoRefreshInterval = null;
  var AUTO_REFRESH_MS = 60000; // 60 segundos

  // ---------------------------------------------------------------------------
  // Config de eventos (iconos y colores)
  // ---------------------------------------------------------------------------
  var EVENT_CONFIG = {
    'creacion':               { icon: '🆕', color: 'blue',   label: 'Creacion' },
    'inicio_ruta':            { icon: '🚀', color: 'green',  label: 'Inicio de ruta' },
    'ubicacion_actualizada':  { icon: '📍', color: 'blue',   label: 'Ubicacion actualizada' },
    'detencion_detectada':    { icon: '⚠️', color: 'red',    label: 'Detencion detectada' },
    'reinicio_movimiento':    { icon: '▶️', color: 'green',  label: 'Reinicio movimiento' },
    'llamada_operador':       { icon: '📞', color: 'purple', label: 'Llamada operador' },
    'llamada_cliente':        { icon: '📞', color: 'purple', label: 'Llamada cliente' },
    'llamada_propietario':    { icon: '📞', color: 'purple', label: 'Llamada propietario' },
    'llamada_ia_operador':    { icon: '🤖', color: 'indigo', label: 'Llamada IA operador' },
    'llamada_ia_coordinador': { icon: '🤖', color: 'indigo', label: 'Llamada IA coord.' },
    'scrape_exitoso':         { icon: '✅', color: 'green',  label: 'Scrape exitoso' },
    'scrape_error':           { icon: '❌', color: 'red',    label: 'Scrape error' },
    'notif_push_proximidad':  { icon: '📲', color: 'blue',   label: 'Notif. proximidad' },
    'modulacion_consultada':  { icon: '🏛️', color: 'amber',  label: 'Modulacion consultada' },
    'alerta_paro_ia':         { icon: '🔔', color: 'red',    label: 'Alerta paro IA' },
    'llegada_destino':        { icon: '🏁', color: 'teal',   label: 'Llegada a destino' },
    'llegada_punto_logistico':{ icon: '📦', color: 'indigo', label: 'Llegada punto log.' }
  };

  // ---------------------------------------------------------------------------
  // Inicializacion
  // ---------------------------------------------------------------------------

  function init() {
    initCoordsGrid();
    initEventsGrid();
    initRefreshButton();

    // Auto-refresh para viajes activos
    if (typeof viajeData !== 'undefined' &&
        (viajeData.estado_actual === 'en_ruta' || viajeData.estado_actual === 'en_espera' || viajeData.estado_actual === 'cargando')) {
      startAutoRefresh();
    }

    console.log('[ViajeDetail] Modulo cargado para viaje #' + (typeof viajeId !== 'undefined' ? viajeId : '?'));
  }

  // ---------------------------------------------------------------------------
  // Syncfusion Grid - Coordenadas
  // ---------------------------------------------------------------------------

  function initCoordsGrid() {
    var gridElement = document.getElementById('coords-grid');
    if (!gridElement || typeof ej === 'undefined') return;

    coordsGrid = new ej.grids.Grid({
      dataSource: typeof coordsData !== 'undefined' ? coordsData : [],
      columns: [
        {
          field: 'id', headerText: 'ID', width: 70, textAlign: 'Center',
          template: function(data) {
            return '<span class="text-xs font-mono text-gray-400">' + data.id + '</span>';
          }
        },
        {
          field: 'latitud', headerText: 'Latitud', width: 120, textAlign: 'Right',
          template: function(data) {
            var val = data.latitud ? parseFloat(data.latitud).toFixed(6) : '—';
            return '<span class="text-sm tabular-nums text-gray-700">' + val + '</span>';
          }
        },
        {
          field: 'longitud', headerText: 'Longitud', width: 120, textAlign: 'Right',
          template: function(data) {
            var val = data.longitud ? parseFloat(data.longitud).toFixed(6) : '—';
            return '<span class="text-sm tabular-nums text-gray-700">' + val + '</span>';
          }
        },
        {
          field: 'velocidad', headerText: 'Vel.', width: 80, textAlign: 'Center',
          template: function(data) {
            if (!data.velocidad && data.velocidad !== 0) return '<span class="text-gray-300">—</span>';
            var vel = parseFloat(data.velocidad);
            var color = vel === 0 ? 'text-red-500' : vel < 30 ? 'text-amber-600' : 'text-green-600';
            return '<span class="text-sm font-medium tabular-nums ' + color + '">' + vel.toFixed(0) + ' km/h</span>';
          }
        },
        {
          field: 'rumbo', headerText: 'Rumbo', width: 70, textAlign: 'Center',
          template: function(data) {
            if (!data.rumbo && data.rumbo !== 0) return '<span class="text-gray-300">—</span>';
            return '<span class="text-sm tabular-nums text-gray-600">' + parseFloat(data.rumbo).toFixed(0) + '°</span>';
          }
        },
        {
          field: 'fuente', headerText: 'Fuente', width: 100,
          template: function(data) {
            if (!data.fuente) return '<span class="text-gray-300">—</span>';
            var fuenteColors = {
              'network': 'bg-blue-50 text-blue-700',
              'js_global': 'bg-green-50 text-green-700',
              'dom': 'bg-purple-50 text-purple-700',
              'manual': 'bg-gray-50 text-gray-700'
            };
            var cls = fuenteColors[data.fuente] || 'bg-gray-50 text-gray-600';
            return '<span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ' + cls + '">' + data.fuente + '</span>';
          }
        },
        {
          field: 'provider_nombre', headerText: 'Proveedor', width: 120,
          template: function(data) {
            return data.provider_nombre
              ? '<span class="text-sm text-gray-600">' + data.provider_nombre + '</span>'
              : '<span class="text-gray-300">—</span>';
          }
        },
        {
          field: 'fecha_gps', headerText: 'Fecha GPS', width: 155,
          template: function(data) {
            return '<span class="text-xs tabular-nums text-gray-500">' + formatDate(data.fecha_gps) + '</span>';
          }
        },
        {
          field: 'fecha_extraccion', headerText: 'Extraccion', width: 155,
          template: function(data) {
            return '<span class="text-xs tabular-nums text-gray-500">' + formatDate(data.fecha_extraccion) + '</span>';
          }
        }
      ],
      allowPaging: true,
      pageSettings: { pageSize: 15, pageSizes: [10, 15, 30, 50] },
      allowSorting: true,
      sortSettings: { columns: [{ field: 'fecha_extraccion', direction: 'Descending' }] },
      allowFiltering: false,
      gridLines: 'Horizontal',
      height: 'auto',
      rowHeight: 40,
      enableHover: true,
      rowSelected: function(args) {
        // Al seleccionar una coordenada, centrar el mapa en ella
        if (args.data && args.data.latitud && args.data.longitud && typeof map !== 'undefined' && map) {
          var lat = parseFloat(args.data.latitud);
          var lng = parseFloat(args.data.longitud);
          if (!isNaN(lat) && !isNaN(lng)) {
            map.panTo({ lat: lat, lng: lng });
            map.setZoom(14);
          }
        }
      }
    });

    coordsGrid.appendTo('#coords-grid');
  }

  // ---------------------------------------------------------------------------
  // Syncfusion Grid - Eventos
  // ---------------------------------------------------------------------------

  function initEventsGrid() {
    var gridElement = document.getElementById('events-grid');
    if (!gridElement || typeof ej === 'undefined') return;

    eventsGrid = new ej.grids.Grid({
      dataSource: typeof eventosData !== 'undefined' ? eventosData : [],
      columns: [
        {
          field: 'tipo_evento', headerText: 'Evento', width: 200,
          template: function(data) {
            var cfg = EVENT_CONFIG[data.tipo_evento] || { icon: '📋', color: 'gray', label: data.tipo_evento };

            var colorMap = {
              'blue': 'bg-blue-50 text-blue-700',
              'green': 'bg-green-50 text-green-700',
              'red': 'bg-red-50 text-red-700',
              'purple': 'bg-purple-50 text-purple-700',
              'indigo': 'bg-indigo-50 text-indigo-700',
              'amber': 'bg-amber-50 text-amber-700',
              'teal': 'bg-teal-50 text-teal-700',
              'gray': 'bg-gray-50 text-gray-600'
            };
            var cls = colorMap[cfg.color] || colorMap.gray;

            return '<div class="flex items-center gap-2">' +
                   '<span class="text-sm">' + cfg.icon + '</span>' +
                   '<span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ' + cls + '">' + cfg.label + '</span>' +
                   '</div>';
          }
        },
        {
          field: 'descripcion', headerText: 'Descripcion', width: 250,
          template: function(data) {
            if (!data.descripcion) return '<span class="text-gray-300">—</span>';
            return '<span class="text-sm text-gray-600 truncate block max-w-[230px]" title="' +
                   data.descripcion.replace(/"/g, '&quot;') + '">' + data.descripcion + '</span>';
          }
        },
        {
          field: 'latitud', headerText: 'Ubicacion', width: 140, textAlign: 'Center',
          template: function(data) {
            if (!data.latitud || !data.longitud) return '<span class="text-gray-300">—</span>';
            var lat = parseFloat(data.latitud).toFixed(4);
            var lng = parseFloat(data.longitud).toFixed(4);
            return '<span class="text-xs tabular-nums text-gray-500">' + lat + ', ' + lng + '</span>';
          }
        },
        {
          field: 'fecha_evento', headerText: 'Fecha', width: 165,
          template: function(data) {
            return '<span class="text-sm tabular-nums text-gray-600">' + formatDate(data.fecha_evento) + '</span>';
          }
        }
      ],
      allowPaging: true,
      pageSettings: { pageSize: 15, pageSizes: [10, 15, 30, 50] },
      allowSorting: true,
      sortSettings: { columns: [{ field: 'fecha_evento', direction: 'Descending' }] },
      allowFiltering: false,
      gridLines: 'Horizontal',
      height: 'auto',
      rowHeight: 44,
      enableHover: true
    });

    eventsGrid.appendTo('#events-grid');
  }

  // ---------------------------------------------------------------------------
  // Refresh Button
  // ---------------------------------------------------------------------------

  function initRefreshButton() {
    var btn = document.getElementById('btn-refresh-detail');
    if (!btn) return;

    btn.addEventListener('click', function() {
      refreshData();

      // Animar icono
      var icon = document.getElementById('detail-refresh-icon');
      if (icon) {
        icon.classList.add('animate-spin');
        setTimeout(function() { icon.classList.remove('animate-spin'); }, 800);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Auto-Refresh
  // ---------------------------------------------------------------------------

  function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(function() {
      refreshData();
    }, AUTO_REFRESH_MS);
  }

  // ---------------------------------------------------------------------------
  // Refresh Data (coordenadas + eventos via AJAX)
  // ---------------------------------------------------------------------------

  function refreshData() {
    if (typeof viajeId === 'undefined') return;

    // Refrescar coordenadas
    fetch('/viajes/api/coordinates/' + viajeId, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    })
    .then(function(res) { return res.json(); })
    .then(function(result) {
      if (result.result && coordsGrid) {
        coordsGrid.dataSource = result.result;
        var totalEl = document.getElementById('coords-total');
        if (totalEl) totalEl.textContent = result.count + ' registros';
        var countEl = document.getElementById('coords-count');
        if (countEl) countEl.textContent = result.count + ' puntos';

        // Actualizar ruta en el mapa
        if (typeof drawRoute === 'function' && typeof map !== 'undefined' && map && result.result.length > 0) {
          drawRoute(result.result);
        }
      }
    })
    .catch(function(err) {
      console.error('[ViajeDetail] Error refrescando coordenadas:', err);
    });

    // Refrescar eventos
    fetch('/viajes/api/events/' + viajeId, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    })
    .then(function(res) { return res.json(); })
    .then(function(result) {
      if (result.result && eventsGrid) {
        eventsGrid.dataSource = result.result;
        var totalEl = document.getElementById('events-total');
        if (totalEl) totalEl.textContent = result.count + ' registros';
      }
    })
    .catch(function(err) {
      console.error('[ViajeDetail] Error refrescando eventos:', err);
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) +
             ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return dateStr;
    }
  }

  // ---------------------------------------------------------------------------
  // Inicializar
  // ---------------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ---------------------------------------------------------------------------
  // API publica
  // ---------------------------------------------------------------------------

  return {
    refreshData: refreshData
  };

})();
