/**
 * Viajes - Modulo frontend
 * Syncfusion Grid completo con filtros, busqueda, estadisticas y acciones
 */

var ViajesModule = (function() {
  'use strict';

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------
  var grid = null;
  var toast = null;
  var currentFilter = 'all';
  var searchQuery = '';
  var searchTimer = null;

  // ---------------------------------------------------------------------------
  // Colores de estado
  // ---------------------------------------------------------------------------
  var STATE_CONFIG = {
    'en_ruta':    { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500', label: 'En Ruta', pulse: true },
    'en_espera':  { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500', label: 'En Espera', pulse: false },
    'cargando':   { bg: 'bg-indigo-100', text: 'text-indigo-800', dot: 'bg-indigo-500', label: 'Cargando', pulse: false },
    'completado': { bg: 'bg-blue-100', text: 'text-blue-800', dot: 'bg-blue-500', label: 'Completado', pulse: false },
    'cancelado':  { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500', label: 'Cancelado', pulse: false }
  };

  // ---------------------------------------------------------------------------
  // Inicializacion
  // ---------------------------------------------------------------------------

  function init() {
    initToast();
    initGrid();
    initFilterTabs();
    initStatCards();
    initSearch();
    initRefreshButton();

    console.log('[Viajes] Modulo cargado');
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  function initToast() {
    var container = document.getElementById('toast-container');
    if (!container || typeof ej === 'undefined') return;

    toast = new ej.notifications.Toast({
      position: { X: 'Right', Y: 'Top' },
      newestOnTop: true,
      showCloseButton: true,
      timeOut: 4000,
      animation: {
        show: { effect: 'SlideRightIn', duration: 300 },
        hide: { effect: 'SlideRightOut', duration: 300 }
      }
    });
    toast.appendTo('#toast-container');
  }

  function showToast(title, content, cssClass) {
    if (!toast) return;
    toast.show({ title: title, content: content, cssClass: cssClass || 'e-toast-success' });
  }

  // ---------------------------------------------------------------------------
  // Syncfusion Grid
  // ---------------------------------------------------------------------------

  function initGrid() {
    var gridElement = document.getElementById('viajes-grid');
    if (!gridElement || typeof ej === 'undefined') return;

    grid = new ej.grids.Grid({
      dataSource: new ej.data.DataManager({
        url: '/viajes/api/list',
        adaptor: new ej.data.WebApiAdaptor(),
        crossDomain: true
      }),
      columns: [
        {
          field: 'id', headerText: 'ID', width: 70, textAlign: 'Center', isPrimaryKey: true,
          template: function(data) {
            return '<span class="text-sm font-mono text-gray-500">#' + data.id + '</span>';
          }
        },
        {
          field: 'numero_economico', headerText: 'Unidad', width: 130,
          template: function(data) {
            var unit = data.numero_economico || '—';
            var placas = data.placas_unidad ? '<span class="text-xs text-gray-400 block mt-0.5">' + data.placas_unidad + '</span>' : '';
            return '<div><span class="font-semibold text-gray-900">' + unit + '</span>' + placas + '</div>';
          }
        },
        {
          field: 'contenedor', headerText: 'Contenedor', width: 140,
          template: function(data) {
            if (!data.numero_contenedor) return '<span class="text-gray-300">—</span>';
            return '<span class="text-sm font-mono text-gray-700">' + data.numero_contenedor + '</span>';
          }
        },
        {
          field: 'origen', headerText: 'Origen', width: 160,
          template: function(data) {
            if (!data.origen) return '<span class="text-gray-300">—</span>';
            return '<div class="flex items-center gap-1.5">' +
                   '<svg class="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                   '<circle cx="12" cy="12" r="3" stroke-width="2"/>' +
                   '</svg>' +
                   '<span class="text-sm text-gray-700 truncate" title="' + data.origen + '">' + data.origen + '</span></div>';
          }
        },
        {
          field: 'destino', headerText: 'Destino', width: 160,
          template: function(data) {
            if (!data.destino) return '<span class="text-gray-300">—</span>';
            return '<div class="flex items-center gap-1.5">' +
                   '<svg class="w-3.5 h-3.5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>' +
                   '</svg>' +
                   '<span class="text-sm text-gray-700 truncate" title="' + data.destino + '">' + data.destino + '</span></div>';
          }
        },
        {
          field: 'estado_actual', headerText: 'Estado', width: 130, textAlign: 'Center',
          template: function(data) {
            var cfg = STATE_CONFIG[data.estado_actual] || { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400', label: data.estado_actual || '—', pulse: false };
            return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ' + cfg.bg + ' ' + cfg.text + '">' +
                   '<span class="w-1.5 h-1.5 rounded-full ' + cfg.dot + ' mr-1.5 ' + (cfg.pulse ? 'animate-pulse' : '') + '"></span>' +
                   cfg.label + '</span>';
          }
        },
        {
          field: 'provider_nombre', headerText: 'Proveedor GPS', width: 140,
          template: function(data) {
            if (!data.provider_nombre) return '<span class="text-gray-300 text-sm">Sin asignar</span>';
            return '<div class="flex items-center gap-1.5">' +
                   '<svg class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>' +
                   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>' +
                   '</svg>' +
                   '<span class="text-sm text-gray-600 truncate">' + data.provider_nombre + '</span></div>';
          }
        },
        {
          field: 'fecha_salida', headerText: 'Salida', width: 155,
          template: function(data) {
            if (!data.fecha_salida) return '<span class="text-gray-300">—</span>';
            return '<span class="text-sm text-gray-600 tabular-nums">' + formatDate(data.fecha_salida) + '</span>';
          }
        },
        {
          field: 'ultima_lat', headerText: 'Ubicacion', width: 130, textAlign: 'Center',
          template: function(data) {
            if (!data.ultima_lat || !data.ultima_lng) {
              return '<span class="text-gray-300 text-xs">Sin ubicacion</span>';
            }
            var lat = parseFloat(data.ultima_lat).toFixed(4);
            var lng = parseFloat(data.ultima_lng).toFixed(4);
            return '<span class="text-xs text-gray-500 tabular-nums" title="' + lat + ', ' + lng + '">' +
                   lat + ', ' + lng + '</span>';
          }
        },
        {
          field: 'frecuencia_monitoreo_min', headerText: 'Monitoreo', width: 100, textAlign: 'Center',
          template: function(data) {
            var val = data.frecuencia_monitoreo_min;
            if (!val) return '<span class="text-gray-300">—</span>';
            return '<span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700">' +
                   '<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
                   val + ' min</span>';
          }
        },
        {
          headerText: '', width: 80, textAlign: 'Center',
          allowFiltering: false, allowSorting: false,
          template: function(data) {
            return '<a href="/viajes/' + data.id + '" ' +
                   'class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors">' +
                   'Ver' +
                   '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>' +
                   '</a>';
          }
        }
      ],
      allowPaging: true,
      pageSettings: { pageSize: 20, pageSizes: [10, 20, 50, 100] },
      allowSorting: true,
      sortSettings: { columns: [{ field: 'fecha_salida', direction: 'Descending' }] },
      allowFiltering: true,
      filterSettings: { type: 'Excel' },
      allowResizing: true,
      allowExcelExport: true,
      allowTextWrap: true,
      gridLines: 'Horizontal',
      height: 'auto',
      rowHeight: 52,
      enableHover: true,
      rowSelected: function(args) {
        // Navegar al detalle al hacer click en la fila (excepto si es el enlace 'Ver')
        if (args.data && args.data.id) {
          var target = args.originalEvent && args.originalEvent.target;
          if (target && (target.tagName === 'A' || target.closest('a'))) return;
          window.location.href = '/viajes/' + args.data.id;
        }
      },
      queryCellInfo: function(args) {
        // Estilos personalizados por fila/celda
        if (args.column.field === 'estado_actual') {
          args.cell.style.overflow = 'visible';
        }
      }
    });

    grid.appendTo('#viajes-grid');
  }

  // ---------------------------------------------------------------------------
  // Filter Tabs
  // ---------------------------------------------------------------------------

  function initFilterTabs() {
    var tabs = document.querySelectorAll('.filter-tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var filter = this.getAttribute('data-filter');
        setFilter(filter);
      });
    });
  }

  function initStatCards() {
    var cards = document.querySelectorAll('.stat-card');
    cards.forEach(function(card) {
      card.addEventListener('click', function() {
        var filter = this.getAttribute('data-filter');
        if (filter) setFilter(filter);
      });
    });
  }

  function setFilter(filter) {
    currentFilter = filter;

    // Actualizar tabs activas
    var tabs = document.querySelectorAll('.filter-tab');
    tabs.forEach(function(tab) {
      var isActive = tab.getAttribute('data-filter') === filter;
      if (isActive) {
        tab.classList.add('bg-white', 'text-gray-700', 'shadow-sm');
        tab.classList.remove('text-gray-500');
      } else {
        tab.classList.remove('bg-white', 'text-gray-700', 'shadow-sm');
        tab.classList.add('text-gray-500');
      }
    });

    // Actualizar cards activas
    var cards = document.querySelectorAll('.stat-card');
    cards.forEach(function(card) {
      var isActive = card.getAttribute('data-filter') === filter;
      if (isActive) {
        card.classList.add('ring-2', 'ring-blue-500', 'ring-offset-1');
      } else {
        card.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-1');
      }
    });

    // Recargar grid con filtro
    refreshGrid();
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  function initSearch() {
    var searchInput = document.getElementById('search-viajes');
    if (!searchInput) return;

    searchInput.addEventListener('input', function() {
      var value = this.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function() {
        searchQuery = value.trim();
        refreshGrid();
      }, 350);
    });

    // Limpiar con Escape
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        this.value = '';
        searchQuery = '';
        refreshGrid();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Refresh Button
  // ---------------------------------------------------------------------------

  function initRefreshButton() {
    var btn = document.getElementById('btn-refresh-viajes');
    if (!btn) return;

    btn.addEventListener('click', function() {
      refreshGrid();
      refreshStats();

      // Animar icono
      var icon = document.getElementById('refresh-icon');
      if (icon) {
        icon.classList.add('animate-spin');
        setTimeout(function() { icon.classList.remove('animate-spin'); }, 800);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------

  function refreshGrid() {
    if (!grid) return;

    var params = [];
    if (currentFilter !== 'all') params.push('estado=' + encodeURIComponent(currentFilter));
    if (searchQuery) params.push('q=' + encodeURIComponent(searchQuery));

    var url = '/viajes/api/list' + (params.length > 0 ? '?' + params.join('&') : '');

    grid.dataSource = new ej.data.DataManager({
      url: url,
      adaptor: new ej.data.WebApiAdaptor(),
      crossDomain: true
    });
  }

  function refreshStats() {
    fetch('/viajes/api/stats', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    })
    .then(function(res) { return res.json(); })
    .then(function(result) {
      if (result.success && result.data) {
        updateStatCard('stat-total', result.data.total);
        updateStatCard('stat-enruta', result.data.en_ruta);
        updateStatCard('stat-enespera', result.data.en_espera);
        updateStatCard('stat-cargando', result.data.cargando);
        updateStatCard('stat-completado', result.data.completado);
        updateStatCard('stat-cancelado', result.data.cancelado);
      }
    })
    .catch(function(err) {
      console.error('[Viajes] Error refrescando stats:', err);
    });
  }

  function updateStatCard(id, value) {
    var el = document.getElementById(id);
    if (el) {
      var newVal = value || 0;
      if (el.textContent !== String(newVal)) {
        el.textContent = newVal;
        // Animacion sutil
        el.style.transform = 'scale(1.1)';
        setTimeout(function() { el.style.transform = 'scale(1)'; }, 200);
      }
    }
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
             ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
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
    refreshGrid: refreshGrid,
    refreshStats: refreshStats,
    setFilter: setFilter
  };

})();
