/**
 * Dashboard Module - Logica interactiva del dashboard
 *
 * Funcionalidades:
 *  - Syncfusion Grid para tabla de viajes activos
 *  - Auto-refresh con countdown (cada 60s)
 *  - Filtros de mapa por estado
 *  - Focus/zoom en viaje al hacer clic
 *  - Toggle tipo de mapa (roadmap/satellite)
 *  - Fullscreen del mapa
 *  - Actualizacion AJAX de stats y marcadores
 */

var DashboardModule = (function() {
  'use strict';

  // ---------------------------------------------------------------------------
  // Estado interno
  // ---------------------------------------------------------------------------
  var REFRESH_INTERVAL = 60; // segundos
  var refreshTimer = null;
  var countdownTimer = null;
  var countdownValue = REFRESH_INTERVAL;
  var currentFilter = 'all';
  var isRefreshing = false;
  var selectedTripId = null;
  var grid = null;

  // ---------------------------------------------------------------------------
  // Inicializacion
  // ---------------------------------------------------------------------------

  function init() {
    console.log('[Dashboard] Modulo cargado. Viajes:', viajesData ? viajesData.length : 0);

    initSyncfusionGrid();
    initAutoRefresh();
    initKeyboardShortcuts();

    // Animar las tarjetas al cargar
    animateCards();
  }

  // ---------------------------------------------------------------------------
  // Syncfusion Grid - Tabla de viajes activos
  // ---------------------------------------------------------------------------

  function initSyncfusionGrid() {
    var gridElement = document.getElementById('viajes-grid');
    if (!gridElement || typeof ej === 'undefined') return;

    try {
      // Preparar datos para el grid
      var gridData = (viajesData || []).map(function(v) {
        return {
          id: v.id,
          numero_economico: v.numero_economico || ('Viaje #' + v.id),
          origen: v.origen || '—',
          destino: v.destino || '—',
          estado_actual: v.estado_actual || '—',
          ultima_lat: v.ultima_lat ? parseFloat(v.ultima_lat).toFixed(5) : '—',
          ultima_lng: v.ultima_lng ? parseFloat(v.ultima_lng).toFixed(5) : '—',
          fecha_salida: v.fecha_salida || null,
          ultima_actualizacion: v.ultima_actualizacion || null,
          minutos_sin_update: v.minutos_sin_update != null ? parseInt(v.minutos_sin_update) : null,
        };
      });

      grid = new ej.grids.Grid({
        dataSource: gridData,
        allowPaging: gridData.length > 10,
        allowSorting: true,
        allowFiltering: true,
        filterSettings: { type: 'Menu' },
        pageSettings: { pageSize: 10, pageSizes: [10, 25, 50] },
        gridLines: 'Horizontal',
        rowHeight: 44,
        columns: [
          {
            field: 'numero_economico',
            headerText: 'Unidad',
            width: 130,
            template: '<span class="font-medium text-gray-900">${numero_economico}</span>',
          },
          {
            field: 'origen',
            headerText: 'Origen',
            width: 160,
          },
          {
            field: 'destino',
            headerText: 'Destino',
            width: 160,
          },
          {
            field: 'estado_actual',
            headerText: 'Estado',
            width: 120,
            template: function(data) {
              var estado = data.estado_actual;
              var color = estado === 'en_ruta' ? 'green' : estado === 'en_espera' ? 'amber' : estado === 'cargando' ? 'indigo' : 'gray';
              var label = estado === 'en_ruta' ? 'En Ruta' : estado === 'en_espera' ? 'En Espera' : estado === 'cargando' ? 'Cargando' : estado;
              return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-' + color + '-100 text-' + color + '-700">' +
                     '<span class="w-1.5 h-1.5 rounded-full bg-' + color + '-500 mr-1.5' + (estado === 'en_ruta' ? ' animate-pulse' : '') + '"></span>' +
                     label + '</span>';
            },
          },
          {
            field: 'fecha_salida',
            headerText: 'Salida',
            width: 140,
            type: 'date',
            format: { type: 'dateTime', format: 'dd/MM/yyyy HH:mm' },
          },
          {
            field: 'ultima_actualizacion',
            headerText: 'Ult. GPS',
            width: 140,
            type: 'date',
            format: { type: 'dateTime', format: 'dd/MM/yyyy HH:mm' },
          },
          {
            field: 'minutos_sin_update',
            headerText: 'Min sin GPS',
            width: 100,
            textAlign: 'Center',
            template: function(data) {
              if (data.minutos_sin_update == null) return '<span class="text-gray-300">—</span>';
              var min = data.minutos_sin_update;
              var cls = min > 30 ? 'text-red-600 font-semibold' : min > 15 ? 'text-amber-600' : 'text-gray-600';
              return '<span class="' + cls + ' tabular-nums">' + min + 'm</span>';
            },
          },
          {
            field: 'id',
            headerText: '',
            width: 80,
            textAlign: 'Center',
            allowFiltering: false,
            allowSorting: false,
            template: '<a href="/viajes/${id}" class="text-blue-600 hover:text-blue-800 text-xs font-medium hover:underline">Detalle →</a>',
          },
        ],
        rowSelected: function(args) {
          if (args.data) {
            var viaje = viajesData.find(function(v) { return v.id === args.data.id; });
            if (viaje && viaje.ultima_lat && viaje.ultima_lng) {
              focusTripOnMap(viaje.id, parseFloat(viaje.ultima_lat), parseFloat(viaje.ultima_lng));
            }
          }
        },
      });

      grid.appendTo('#viajes-grid');
    } catch (err) {
      console.error('[Dashboard] Error inicializando Syncfusion Grid:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-refresh
  // ---------------------------------------------------------------------------

  function initAutoRefresh() {
    var toggle = document.getElementById('auto-refresh-toggle');
    if (toggle) {
      toggle.addEventListener('change', function() {
        if (this.checked) {
          startAutoRefresh();
        } else {
          stopAutoRefresh();
        }
      });
    }

    startAutoRefresh();
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    countdownValue = REFRESH_INTERVAL;
    updateCountdownDisplay();

    countdownTimer = setInterval(function() {
      countdownValue--;
      updateCountdownDisplay();
      if (countdownValue <= 0) {
        refresh();
        countdownValue = REFRESH_INTERVAL;
      }
    }, 1000);
  }

  function stopAutoRefresh() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    var el = document.getElementById('refresh-countdown');
    if (el) el.textContent = '';
  }

  function updateCountdownDisplay() {
    var el = document.getElementById('refresh-countdown');
    if (el) {
      el.textContent = countdownValue + 's';
    }
  }

  // ---------------------------------------------------------------------------
  // Refresh AJAX
  // ---------------------------------------------------------------------------

  function refresh() {
    if (isRefreshing) return;
    isRefreshing = true;

    // UI feedback
    var refreshIcon = document.getElementById('refresh-icon');
    var mapLoading = document.getElementById('map-loading');
    if (refreshIcon) refreshIcon.classList.add('animate-spin');
    if (mapLoading) mapLoading.classList.remove('hidden');

    fetch('/dashboard/api/refresh', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.success) {
        // Actualizar datos globales
        viajesData = data.viajes;

        // Actualizar stats
        updateStats(data.stats);

        // Actualizar marcadores del mapa
        if (typeof addViajeMarkers === 'function' && map) {
          var filteredViajes = currentFilter === 'all'
            ? data.viajes
            : data.viajes.filter(function(v) { return v.estado_actual === currentFilter; });
          addViajeMarkers(filteredViajes);
        }

        // Actualizar grid
        updateGrid(data.viajes);

        // Actualizar lista lateral
        updateTripList(data.viajes);

        // Actualizar timestamp
        var timeEl = document.getElementById('last-update-time');
        if (timeEl) {
          timeEl.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        }
      }
    })
    .catch(function(err) {
      console.error('[Dashboard] Error en refresh:', err);
    })
    .finally(function() {
      isRefreshing = false;
      if (refreshIcon) refreshIcon.classList.remove('animate-spin');
      if (mapLoading) mapLoading.classList.add('hidden');
      countdownValue = REFRESH_INTERVAL;
    });
  }

  function updateStats(stats) {
    animateValue('stat-total', stats.total);
    animateValue('stat-enruta', stats.enRuta);
    animateValue('stat-enespera', stats.enEspera);
    animateValue('stat-cargando', stats.cargando);
    animateValue('stat-alertas', stats.alertas);
  }

  function animateValue(elementId, newValue) {
    var el = document.getElementById(elementId);
    if (!el) return;
    var current = parseInt(el.textContent) || 0;
    if (current === newValue) return;

    // Flash de color al cambiar
    el.classList.add('transition-transform', 'duration-200');
    el.style.transform = 'scale(1.15)';
    el.textContent = newValue;

    setTimeout(function() {
      el.style.transform = 'scale(1)';
    }, 200);
  }

  function updateGrid(viajes) {
    if (!grid) return;

    try {
      var gridData = viajes.map(function(v) {
        return {
          id: v.id,
          numero_economico: v.numero_economico || ('Viaje #' + v.id),
          origen: v.origen || '—',
          destino: v.destino || '—',
          estado_actual: v.estado_actual || '—',
          ultima_lat: v.ultima_lat ? parseFloat(v.ultima_lat).toFixed(5) : '—',
          ultima_lng: v.ultima_lng ? parseFloat(v.ultima_lng).toFixed(5) : '—',
          fecha_salida: v.fecha_salida || null,
          ultima_actualizacion: v.ultima_actualizacion || null,
          minutos_sin_update: v.minutos_sin_update != null ? parseInt(v.minutos_sin_update) : null,
        };
      });

      grid.dataSource = gridData;
    } catch (err) {
      console.error('[Dashboard] Error actualizando grid:', err);
    }
  }

  function updateTripList(viajes) {
    var container = document.getElementById('trip-list');
    if (!container) return;

    if (!viajes || viajes.length === 0) {
      container.innerHTML =
        '<div class="p-6 text-center">' +
        '<svg class="w-10 h-10 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>' +
        '</svg>' +
        '<p class="text-sm text-gray-400">No hay viajes activos</p>' +
        '</div>';
      return;
    }

    var html = '';
    viajes.slice(0, 20).forEach(function(viaje) {
      var badgeColor = viaje.estado_actual === 'en_ruta' ? 'green'
                     : viaje.estado_actual === 'en_espera' ? 'amber'
                     : viaje.estado_actual === 'cargando' ? 'indigo' : 'gray';
      var label = viaje.estado_actual === 'en_ruta' ? 'Ruta'
               : viaje.estado_actual === 'en_espera' ? 'Espera'
               : viaje.estado_actual === 'cargando' ? 'Cargando' : viaje.estado_actual;
      var pulse = viaje.estado_actual === 'en_ruta' ? ' animate-pulse' : '';

      html += '<div class="trip-item px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors" ' +
              'data-viaje-id="' + viaje.id + '" ' +
              'data-lat="' + (viaje.ultima_lat || '') + '" ' +
              'data-lng="' + (viaje.ultima_lng || '') + '" ' +
              'onclick="DashboardModule.focusTrip(this)">' +
              '<div class="flex items-center justify-between">' +
              '<div class="min-w-0 flex-1">' +
              '<p class="text-sm font-medium text-gray-900 truncate">' + (viaje.numero_economico || ('Viaje #' + viaje.id)) + '</p>' +
              '<p class="text-xs text-gray-500 truncate mt-0.5">' + (viaje.origen || '—') + ' → ' + (viaje.destino || '—') + '</p>' +
              '</div>' +
              '<div class="flex-shrink-0 ml-2">' +
              '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-' + badgeColor + '-100 text-' + badgeColor + '-700">' +
              '<span class="w-1.5 h-1.5 rounded-full bg-' + badgeColor + '-500 mr-1.5' + pulse + '"></span>' +
              label + '</span>' +
              '</div></div>';

      if (viaje.ultima_lat && viaje.ultima_lng) {
        html += '<div class="flex items-center gap-1 mt-1.5">' +
                '<svg class="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/></svg>' +
                '<span class="text-xs text-gray-400 tabular-nums">' + parseFloat(viaje.ultima_lat).toFixed(4) + ', ' + parseFloat(viaje.ultima_lng).toFixed(4) + '</span>' +
                '</div>';
      }
      html += '</div>';
    });

    container.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Filtros del mapa
  // ---------------------------------------------------------------------------

  function filterMap(filter) {
    currentFilter = filter;

    // Actualizar UI de botones de filtro
    var buttons = document.querySelectorAll('.map-filter-btn');
    buttons.forEach(function(btn) {
      var btnFilter = btn.getAttribute('data-filter');
      if (btnFilter === filter) {
        btn.classList.add('bg-white', 'text-gray-700', 'shadow-sm');
        btn.classList.remove('text-gray-500');
      } else {
        btn.classList.remove('bg-white', 'text-gray-700', 'shadow-sm');
        btn.classList.add('text-gray-500');
      }
    });

    // Filtrar marcadores en el mapa
    if (typeof addViajeMarkers === 'function' && map) {
      var filteredViajes = filter === 'all'
        ? viajesData
        : viajesData.filter(function(v) { return v.estado_actual === filter; });
      addViajeMarkers(filteredViajes);
    }
  }

  // ---------------------------------------------------------------------------
  // Focus en viaje (clic en lista lateral)
  // ---------------------------------------------------------------------------

  function focusTrip(element) {
    var lat = parseFloat(element.getAttribute('data-lat'));
    var lng = parseFloat(element.getAttribute('data-lng'));
    var id = element.getAttribute('data-viaje-id');

    if (isNaN(lat) || isNaN(lng)) return;

    // Highlight en la lista
    document.querySelectorAll('.trip-item').forEach(function(el) {
      el.classList.remove('bg-blue-50', 'border-l-2', 'border-blue-500');
    });
    element.classList.add('bg-blue-50', 'border-l-2', 'border-blue-500');

    focusTripOnMap(id, lat, lng);
  }

  function focusTripOnMap(id, lat, lng) {
    if (!map) return;

    // Hacer zoom suave al marcador
    map.panTo({ lat: lat, lng: lng });
    map.setZoom(12);

    // Abrir infoWindow del marcador correspondiente
    if (typeof markers !== 'undefined') {
      markers.forEach(function(m) {
        if (m._viajeId == id) {
          google.maps.event.trigger(m, 'click');
        }
      });
    }

    // Scroll al mapa en mobile
    var mapContainer = document.getElementById('map-container');
    if (mapContainer && window.innerWidth < 1280) {
      mapContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ---------------------------------------------------------------------------
  // Toggle tipo de mapa
  // ---------------------------------------------------------------------------

  function toggleMapType() {
    if (!map) return;
    var currentType = map.getMapTypeId();
    map.setMapTypeId(currentType === 'roadmap' ? 'satellite' : 'roadmap');
  }

  // ---------------------------------------------------------------------------
  // Fullscreen del mapa
  // ---------------------------------------------------------------------------

  function toggleFullscreen() {
    var mapContainer = document.getElementById('map-container');
    if (!mapContainer) return;

    if (!document.fullscreenElement) {
      mapContainer.requestFullscreen().catch(function(err) {
        console.warn('[Dashboard] Fullscreen no disponible:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  // ---------------------------------------------------------------------------
  // Atajos de teclado
  // ---------------------------------------------------------------------------

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      // R = Refresh manual
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
        e.preventDefault();
        refresh();
      }
      // Escape = Reset filtro
      if (e.key === 'Escape') {
        filterMap('all');
        selectedTripId = null;
      }
    });
  }

  function isInputFocused() {
    var tag = document.activeElement ? document.activeElement.tagName : '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  // ---------------------------------------------------------------------------
  // Animaciones
  // ---------------------------------------------------------------------------

  function animateCards() {
    var cards = document.querySelectorAll('.dashboard-card');
    cards.forEach(function(card, index) {
      card.style.opacity = '0';
      card.style.transform = 'translateY(10px)';
      card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

      setTimeout(function() {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, index * 60);
    });
  }

  // ---------------------------------------------------------------------------
  // Inicializar cuando el DOM este listo
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
    refresh: refresh,
    filterMap: filterMap,
    focusTrip: focusTrip,
    toggleMapType: toggleMapType,
    toggleFullscreen: toggleFullscreen,
  };

})();
