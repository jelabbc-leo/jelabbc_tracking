/**
 * Registro de licencia Syncfusion
 * Se lee desde el meta tag o variable global
 */
(function() {
  // Buscar la licencia en el DOM o usar la global
  var licenseKey = '';
  var meta = document.querySelector('meta[name="syncfusion-license"]');
  if (meta) {
    licenseKey = meta.getAttribute('content');
  }

  // Intentar registrar si ej2 esta disponible
  if (typeof ej !== 'undefined' && ej.base && ej.base.registerLicense) {
    if (licenseKey) {
      ej.base.registerLicense(licenseKey);
    }
  }
})();
