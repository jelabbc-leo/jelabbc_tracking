/**
 * Proveedores GPS - Modulo frontend
 * Syncfusion Grid + Dialog para CRUD completo de conf_providers
 */

var ProvidersModule = (function() {
  'use strict';

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------
  var grid = null;
  var dialog = null;
  var deleteDialog = null;
  var toast = null;
  var editingId = null; // null = crear, number = editar

  // ---------------------------------------------------------------------------
  // Inicializacion
  // ---------------------------------------------------------------------------

  function init() {
    initToast();
    initGrid();
    initDialog();
    initDeleteDialog();
    initFormListeners();
    bindAddButton();

    console.log('[Providers] Modulo cargado');
  }

  // ---------------------------------------------------------------------------
  // Toast Notifications
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
    toast.show({
      title: title,
      content: content,
      cssClass: cssClass || 'e-toast-success'
    });
  }

  // ---------------------------------------------------------------------------
  // Syncfusion Grid
  // ---------------------------------------------------------------------------

  function initGrid() {
    var gridElement = document.getElementById('providers-grid');
    if (!gridElement || typeof ej === 'undefined') return;

    grid = new ej.grids.Grid({
      dataSource: new ej.data.DataManager({
        url: '/providers/api/list',
        adaptor: new ej.data.WebApiAdaptor(),
        crossDomain: true
      }),
      columns: [
        { field: 'id', headerText: 'ID', width: 65, textAlign: 'Center', isPrimaryKey: true },
        {
          field: 'nombre', headerText: 'Nombre', width: 160,
          template: '<span class="font-medium text-gray-900">${nombre}</span>'
        },
        {
          field: 'url', headerText: 'URL', width: 260,
          template: '<a href="${url}" target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-800 hover:underline text-sm truncate block max-w-[240px]" title="${url}">${url}</a>'
        },
        { field: 'username', headerText: 'Usuario', width: 120 },
        {
          field: 'intervalo_minutos', headerText: 'Intervalo', width: 100, textAlign: 'Center',
          template: function(data) {
            var val = data.intervalo_minutos || 5;
            return '<span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700">' +
                   '<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
                   val + ' min</span>';
          }
        },
        {
          field: 'activo', headerText: 'Estado', width: 100, textAlign: 'Center',
          template: function(data) {
            if (data.activo) {
              return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">' +
                     '<span class="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse"></span>Activo</span>';
            }
            return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">' +
                   '<span class="w-1.5 h-1.5 rounded-full bg-gray-400 mr-1.5"></span>Inactivo</span>';
          }
        },
        {
          field: 'ultimo_scrape', headerText: 'Ultimo Scrape', width: 170,
          template: function(data) {
            if (!data.ultimo_scrape) {
              return '<span class="text-gray-300 text-sm">Nunca</span>';
            }
            var d = new Date(data.ultimo_scrape);
            var formatted = d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
                            ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
            return '<span class="text-sm text-gray-600 tabular-nums">' + formatted + '</span>';
          }
        },
        {
          headerText: 'Acciones', width: 120, textAlign: 'Center',
          allowFiltering: false, allowSorting: false,
          template: function(data) {
            return '<div class="flex items-center justify-center gap-1">' +
                   '<button class="btn-edit-provider p-1.5 rounded-md text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors" data-id="' + data.id + '" title="Editar">' +
                   '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>' +
                   '</button>' +
                   '<button class="btn-delete-provider p-1.5 rounded-md text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors" data-id="' + data.id + '" data-name="' + (data.nombre || '') + '" title="Eliminar">' +
                   '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>' +
                   '</button>' +
                   '</div>';
          }
        }
      ],
      allowPaging: true,
      pageSettings: { pageSize: 15 },
      allowSorting: true,
      allowFiltering: true,
      filterSettings: { type: 'Excel' },
      gridLines: 'Horizontal',
      height: 'auto',
      rowHeight: 48,
      dataBound: function() {
        // Bind acciones despues de que el grid renderice
        bindGridActions();
      },
      actionComplete: function(args) {
        if (args.requestType === 'paging' || args.requestType === 'sorting' || args.requestType === 'filtering') {
          setTimeout(bindGridActions, 100);
        }
      }
    });

    grid.appendTo('#providers-grid');
  }

  function bindGridActions() {
    // Botones editar
    var editBtns = document.querySelectorAll('.btn-edit-provider');
    editBtns.forEach(function(btn) {
      btn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        var id = parseInt(this.getAttribute('data-id'));
        openEditDialog(id);
      };
    });

    // Botones eliminar
    var deleteBtns = document.querySelectorAll('.btn-delete-provider');
    deleteBtns.forEach(function(btn) {
      btn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        var id = parseInt(this.getAttribute('data-id'));
        var name = this.getAttribute('data-name') || 'este proveedor';
        confirmDelete(id, name);
      };
    });
  }

  function refreshGrid() {
    if (grid) {
      grid.refresh();
    }
  }

  // ---------------------------------------------------------------------------
  // Syncfusion Dialog - Crear/Editar
  // ---------------------------------------------------------------------------

  function initDialog() {
    var dialogEl = document.getElementById('provider-dialog');
    if (!dialogEl || typeof ej === 'undefined') return;

    dialog = new ej.popups.Dialog({
      header: 'Nuevo Proveedor',
      width: '640px',
      isModal: true,
      visible: false,
      showCloseIcon: true,
      closeOnEscape: true,
      animationSettings: { effect: 'Zoom', duration: 300 },
      cssClass: 'provider-dialog',
      buttons: [
        {
          buttonModel: {
            content: 'Cancelar',
            cssClass: 'e-flat'
          },
          click: function() {
            dialog.hide();
          }
        },
        {
          buttonModel: {
            content: 'Guardar',
            cssClass: 'e-primary e-flat',
            iconCss: 'e-icons e-check'
          },
          click: function() {
            saveProvider();
          }
        }
      ],
      open: function() {
        // Focus en primer campo
        var nombre = document.getElementById('prov-nombre');
        if (nombre) {
          setTimeout(function() { nombre.focus(); }, 200);
        }
      },
      close: function() {
        resetForm();
      }
    });

    dialog.appendTo('#provider-dialog');
  }

  // ---------------------------------------------------------------------------
  // Syncfusion Dialog - Confirmar Eliminacion
  // ---------------------------------------------------------------------------

  function initDeleteDialog() {
    var deleteEl = document.getElementById('delete-dialog');
    if (!deleteEl || typeof ej === 'undefined') return;

    deleteDialog = new ej.popups.Dialog({
      header: 'Confirmar eliminacion',
      width: '420px',
      isModal: true,
      visible: false,
      showCloseIcon: true,
      closeOnEscape: true,
      animationSettings: { effect: 'Zoom', duration: 250 },
      cssClass: 'delete-dialog',
      buttons: [
        {
          buttonModel: {
            content: 'Cancelar',
            cssClass: 'e-flat'
          },
          click: function() {
            deleteDialog.hide();
          }
        },
        {
          buttonModel: {
            content: 'Eliminar',
            cssClass: 'e-danger e-flat',
            iconCss: 'e-icons e-trash'
          },
          click: function() {
            executeDelete();
          }
        }
      ]
    });

    deleteDialog.appendTo('#delete-dialog');
  }

  // ---------------------------------------------------------------------------
  // Form listeners
  // ---------------------------------------------------------------------------

  function initFormListeners() {
    // Toggle iframe selector visibility
    var iframeCheckbox = document.getElementById('prov-login-iframe');
    if (iframeCheckbox) {
      iframeCheckbox.addEventListener('change', function() {
        var wrap = document.getElementById('prov-iframe-selector-wrap');
        if (wrap) {
          wrap.classList.toggle('hidden', !this.checked);
        }
      });
    }

    // Submit con Enter
    var formInputs = document.querySelectorAll('#provider-dialog input:not([type="checkbox"])');
    formInputs.forEach(function(input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveProvider();
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Boton agregar
  // ---------------------------------------------------------------------------

  function bindAddButton() {
    var addBtn = document.getElementById('btn-add-provider');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        openCreateDialog();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Abrir dialogs
  // ---------------------------------------------------------------------------

  function openCreateDialog() {
    if (!dialog) return;

    editingId = null;
    resetForm();
    dialog.header = '<span class="flex items-center gap-2">' +
                    '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>' +
                    'Nuevo Proveedor</span>';
    dialog.show();
  }

  function openEditDialog(id) {
    if (!dialog) return;

    // Obtener datos completos del proveedor desde el servidor
    fetch('/providers/api/detail/' + id, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    })
    .then(function(res) { return res.json(); })
    .then(function(result) {
      if (result.success && result.data) {
        editingId = id;
        populateForm(result.data);
        dialog.header = '<span class="flex items-center gap-2">' +
                        '<svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>' +
                        'Editar Proveedor</span>';
        dialog.show();
      } else {
        showToast('Error', result.error || 'No se encontraron datos del proveedor', 'e-toast-danger');
      }
    })
    .catch(function(err) {
      console.error('[Providers] Error obteniendo detalle:', err);
      showToast('Error', 'No se pudo cargar los datos del proveedor', 'e-toast-danger');
    });
  }

  function confirmDelete(id, name) {
    if (!deleteDialog) return;

    deleteDialog._deleteId = id;
    var nameEl = document.getElementById('delete-provider-name');
    if (nameEl) nameEl.textContent = name;
    deleteDialog.show();
  }

  // ---------------------------------------------------------------------------
  // Form: poblar y resetear
  // ---------------------------------------------------------------------------

  function populateForm(data) {
    setVal('prov-nombre', data.nombre || '');
    setVal('prov-url', data.url || '');
    setVal('prov-username', data.username || '');
    setVal('prov-password', data.password || '');
    setVal('prov-selector-user', data.selector_user || '');
    setVal('prov-selector-pass', data.selector_pass || '');
    setVal('prov-selector-login', data.selector_login_btn || '');
    setVal('prov-intervalo', data.intervalo_minutos || 5);
    setVal('prov-iframe-selector', data.iframe_selector || '');

    setChecked('prov-login-iframe', !!data.login_in_iframe);
    setChecked('prov-activo', data.activo !== false && data.activo !== 0);

    // Mostrar/ocultar selector iframe
    var wrap = document.getElementById('prov-iframe-selector-wrap');
    if (wrap) {
      wrap.classList.toggle('hidden', !data.login_in_iframe);
    }
  }

  function resetForm() {
    editingId = null;
    setVal('prov-nombre', '');
    setVal('prov-url', '');
    setVal('prov-username', '');
    setVal('prov-password', '');
    setVal('prov-selector-user', '');
    setVal('prov-selector-pass', '');
    setVal('prov-selector-login', '');
    setVal('prov-intervalo', 5);
    setVal('prov-iframe-selector', '');
    setChecked('prov-login-iframe', false);
    setChecked('prov-activo', true);

    var wrap = document.getElementById('prov-iframe-selector-wrap');
    if (wrap) wrap.classList.add('hidden');

    // Limpiar errores de validacion
    var errorEls = document.querySelectorAll('#provider-dialog .field-error');
    errorEls.forEach(function(el) { el.remove(); });
    var errorInputs = document.querySelectorAll('#provider-dialog .border-red-500');
    errorInputs.forEach(function(el) { el.classList.remove('border-red-500'); });
  }

  // ---------------------------------------------------------------------------
  // Helpers DOM
  // ---------------------------------------------------------------------------

  function setVal(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value;
  }

  function getVal(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function getChecked(id) {
    var el = document.getElementById(id);
    return el ? el.checked : false;
  }

  function setChecked(id, value) {
    var el = document.getElementById(id);
    if (el) el.checked = value;
  }

  // ---------------------------------------------------------------------------
  // Validacion
  // ---------------------------------------------------------------------------

  function validateForm() {
    var isValid = true;

    // Limpiar errores previos
    var errorEls = document.querySelectorAll('#provider-dialog .field-error');
    errorEls.forEach(function(el) { el.remove(); });
    var errorInputs = document.querySelectorAll('#provider-dialog .border-red-500');
    errorInputs.forEach(function(el) { el.classList.remove('border-red-500'); });

    // Nombre requerido
    if (!getVal('prov-nombre')) {
      markError('prov-nombre', 'El nombre es requerido');
      isValid = false;
    }

    // URL requerida y valida
    var url = getVal('prov-url');
    if (!url) {
      markError('prov-url', 'La URL es requerida');
      isValid = false;
    } else if (!url.match(/^https?:\/\/.+/)) {
      markError('prov-url', 'La URL debe comenzar con http:// o https://');
      isValid = false;
    }

    // Intervalo valido
    var intervalo = parseInt(getVal('prov-intervalo'));
    if (isNaN(intervalo) || intervalo < 1 || intervalo > 60) {
      markError('prov-intervalo', 'Intervalo entre 1 y 60 minutos');
      isValid = false;
    }

    return isValid;
  }

  function markError(inputId, message) {
    var input = document.getElementById(inputId);
    if (!input) return;

    input.classList.add('border-red-500');

    var errorEl = document.createElement('p');
    errorEl.className = 'field-error text-xs text-red-600 mt-1';
    errorEl.textContent = message;
    input.parentNode.appendChild(errorEl);

    // Focus primer error
    if (!document.querySelector('#provider-dialog .border-red-500:focus')) {
      input.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Guardar (Crear / Actualizar)
  // ---------------------------------------------------------------------------

  function saveProvider() {
    if (!validateForm()) return;

    var data = {
      nombre: getVal('prov-nombre'),
      url: getVal('prov-url'),
      username: getVal('prov-username') || null,
      password: getVal('prov-password') || null,
      selector_user: getVal('prov-selector-user') || null,
      selector_pass: getVal('prov-selector-pass') || null,
      selector_login_btn: getVal('prov-selector-login') || null,
      login_in_iframe: getChecked('prov-login-iframe') ? 1 : 0,
      iframe_selector: getChecked('prov-login-iframe') ? (getVal('prov-iframe-selector') || null) : null,
      intervalo_minutos: parseInt(getVal('prov-intervalo')) || 5,
      activo: getChecked('prov-activo') ? 1 : 0
    };

    // Deshabilitar boton guardar
    setDialogButtonsEnabled(false);

    var isEdit = editingId !== null;
    var url = isEdit ? '/providers/api/update/' + editingId : '/providers/api/create';
    var method = isEdit ? 'PUT' : 'POST';

    fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    .then(function(res) { return res.json(); })
    .then(function(result) {
      if (result.success) {
        dialog.hide();
        refreshGrid();
        showToast(
          isEdit ? 'Proveedor actualizado' : 'Proveedor creado',
          isEdit
            ? 'Se actualizo correctamente "' + data.nombre + '"'
            : 'Se creo correctamente "' + data.nombre + '"',
          'e-toast-success'
        );
      } else {
        showToast('Error', result.error || 'Ocurrio un error al guardar', 'e-toast-danger');
      }
    })
    .catch(function(err) {
      console.error('[Providers] Error guardando:', err);
      showToast('Error', 'No se pudo conectar con el servidor', 'e-toast-danger');
    })
    .finally(function() {
      setDialogButtonsEnabled(true);
    });
  }

  // ---------------------------------------------------------------------------
  // Eliminar
  // ---------------------------------------------------------------------------

  function executeDelete() {
    if (!deleteDialog || !deleteDialog._deleteId) return;

    var id = deleteDialog._deleteId;

    // Deshabilitar boton eliminar
    setDeleteButtonsEnabled(false);

    fetch('/providers/api/delete/' + id, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(function(res) { return res.json(); })
    .then(function(result) {
      if (result.success) {
        deleteDialog.hide();
        refreshGrid();
        showToast('Proveedor eliminado', 'Se elimino correctamente el proveedor', 'e-toast-success');
      } else {
        showToast('Error', result.error || 'No se pudo eliminar el proveedor', 'e-toast-danger');
      }
    })
    .catch(function(err) {
      console.error('[Providers] Error eliminando:', err);
      showToast('Error', 'No se pudo conectar con el servidor', 'e-toast-danger');
    })
    .finally(function() {
      setDeleteButtonsEnabled(true);
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers botones dialog
  // ---------------------------------------------------------------------------

  function setDialogButtonsEnabled(enabled) {
    if (!dialog || !dialog.btnObj) return;
    dialog.btnObj.forEach(function(btn) {
      btn.disabled = !enabled;
    });
  }

  function setDeleteButtonsEnabled(enabled) {
    if (!deleteDialog || !deleteDialog.btnObj) return;
    deleteDialog.btnObj.forEach(function(btn) {
      btn.disabled = !enabled;
    });
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
    openCreateDialog: openCreateDialog
  };

})();
