/**
 * Puppeteer Browser Manager
 *
 * Responsabilidades:
 *  - Pool de navegadores Puppeteer con limite configurable
 *  - Launch con opciones optimizadas para Azure App Service / Linux
 *  - Login generico: llenar usuario/password con selectores configurables
 *  - Manejo de iframes (login dentro de iframe)
 *  - Navegacion con espera inteligente
 *  - Limpieza de recursos (cerrar browsers al terminar)
 */

'use strict';

const puppeteer = require('puppeteer');

const LOG_PREFIX = '[Browser]';

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

const MAX_BROWSERS = parseInt(process.env.MAX_CONCURRENT_BROWSERS || '2', 10);
const IS_HEADLESS = process.env.PUPPETEER_HEADLESS !== 'false';
const NAVIGATION_TIMEOUT = 60000;   // 60s para navegar
const LOGIN_TIMEOUT = 30000;        // 30s para login
const PAGE_LOAD_WAIT = 5000;        // 5s espera adicional post-login

// Opciones de launch optimizadas para servidor (bajo consumo de recursos)
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',       // Evitar problemas de memoria en Docker/Azure
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-default-browser-check',
  '--window-size=1920,1080',
];

// ---------------------------------------------------------------------------
// Browser Pool
// ---------------------------------------------------------------------------

/** @type {import('puppeteer').Browser[]} */
const browserPool = [];

/** @type {Set<import('puppeteer').Browser>} */
const busyBrowsers = new Set();

/**
 * Obtiene un navegador del pool o lanza uno nuevo si hay capacidad.
 * Bloquea si el pool esta lleno hasta que se libere uno.
 *
 * @returns {Promise<import('puppeteer').Browser>}
 */
async function acquireBrowser() {
  // Buscar un browser libre en el pool
  for (const browser of browserPool) {
    if (!busyBrowsers.has(browser)) {
      try {
        // Verificar que sigue vivo
        const pages = await browser.pages();
        if (pages) {
          busyBrowsers.add(browser);
          log('info', `Browser reutilizado del pool (${busyBrowsers.size}/${MAX_BROWSERS} activos)`);
          return browser;
        }
      } catch {
        // Browser muerto, remover del pool
        _removeFromPool(browser);
      }
    }
  }

  // Si hay capacidad, lanzar uno nuevo
  if (browserPool.length < MAX_BROWSERS) {
    log('info', 'Lanzando nuevo browser...');
    const launchOptions = {
      headless: IS_HEADLESS ? 'new' : false,
      args: LAUNCH_ARGS,
      defaultViewport: { width: 1920, height: 1080 },
      timeout: NAVIGATION_TIMEOUT,
    };

    // Usar Chrome del sistema si esta configurado
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const browser = await puppeteer.launch(launchOptions);

    browserPool.push(browser);
    busyBrowsers.add(browser);

    // Listener para cuando se desconecta inesperadamente
    browser.on('disconnected', () => {
      log('warn', 'Browser desconectado inesperadamente');
      _removeFromPool(browser);
    });

    log('info', `Nuevo browser lanzado (${browserPool.length} en pool, ${busyBrowsers.size} activos)`);
    return browser;
  }

  // Pool lleno: esperar a que se libere uno (polling con backoff)
  log('warn', `Pool lleno (${MAX_BROWSERS}), esperando browser libre...`);
  return new Promise((resolve) => {
    const check = setInterval(async () => {
      for (const browser of browserPool) {
        if (!busyBrowsers.has(browser)) {
          clearInterval(check);
          busyBrowsers.add(browser);
          resolve(browser);
          return;
        }
      }
    }, 1000);

    // Timeout de seguridad (2 minutos)
    setTimeout(() => {
      clearInterval(check);
      log('error', 'Timeout esperando browser libre');
      resolve(null);
    }, 120000);
  });
}

/**
 * Libera un browser de vuelta al pool (no lo cierra, lo reutiliza).
 *
 * @param {import('puppeteer').Browser} browser
 * @param {boolean} [closeBrowser=false] - Si true, cierra el browser completamente
 */
async function releaseBrowser(browser, closeBrowser = false) {
  busyBrowsers.delete(browser);

  if (closeBrowser) {
    _removeFromPool(browser);
    try {
      await browser.close();
      log('info', 'Browser cerrado y removido del pool');
    } catch {
      // Ya estaba cerrado
    }
    return;
  }

  // Limpiar paginas extra (mantener solo about:blank)
  try {
    const pages = await browser.pages();
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close().catch(() => {});
    }
    // Navegar la primera pagina a blank
    if (pages.length > 0) {
      await pages[0].goto('about:blank').catch(() => {});
    }
  } catch {
    // Error limpiando, cerrar el browser
    _removeFromPool(browser);
    try { await browser.close(); } catch {}
  }

  log('info', `Browser liberado (${busyBrowsers.size}/${browserPool.length} activos)`);
}

/**
 * Cierra todos los browsers del pool.
 * Usar al apagar el servidor o en limpieza.
 */
async function closeAll() {
  log('info', `Cerrando ${browserPool.length} browsers...`);

  const promises = browserPool.map(async (browser) => {
    try {
      await browser.close();
    } catch {
      // Ya cerrado
    }
  });

  await Promise.all(promises);
  browserPool.length = 0;
  busyBrowsers.clear();

  log('info', 'Todos los browsers cerrados');
}

// ---------------------------------------------------------------------------
// Navegacion y Login
// ---------------------------------------------------------------------------

/**
 * Crea una nueva pagina en el browser con configuracion optimizada.
 *
 * @param {import('puppeteer').Browser} browser
 * @returns {Promise<import('puppeteer').Page>}
 */
async function createPage(browser) {
  const page = await browser.newPage();

  // Configurar timeouts
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
  page.setDefaultTimeout(NAVIGATION_TIMEOUT);

  // User agent realista
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Bloquear recursos pesados no necesarios (imagenes, fonts, media)
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  return page;
}

/**
 * Navega a una URL y espera a que la pagina cargue.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.waitUntil='networkidle2'] - Condicion de espera
 * @param {number} [options.extraWaitMs=2000] - Espera adicional post-carga
 * @returns {Promise<void>}
 */
async function navigateTo(page, url, options = {}) {
  const waitUntil = options.waitUntil || 'networkidle2';
  const extraWaitMs = options.extraWaitMs || 2000;

  log('info', `Navegando a: ${url}`);

  await page.goto(url, {
    waitUntil,
    timeout: NAVIGATION_TIMEOUT,
  });

  // Espera adicional para que carguen datos dinamicos
  if (extraWaitMs > 0) {
    await _sleep(extraWaitMs);
  }
}

/**
 * Realiza login generico en una plataforma GPS.
 * Soporta login directo y login dentro de iframe.
 *
 * @param {import('puppeteer').Page} page - Pagina ya navegada a la URL de login
 * @param {object} provider - Datos del proveedor (de conf_providers)
 * @param {string} provider.username - Usuario
 * @param {string} provider.password - Password
 * @param {string} provider.selector_user - Selector CSS del campo usuario
 * @param {string} provider.selector_pass - Selector CSS del campo password
 * @param {string} provider.selector_login_btn - Selector CSS del boton de login
 * @param {boolean} [provider.login_in_iframe] - Si el login esta dentro de un iframe
 * @param {string} [provider.iframe_selector] - Selector del iframe
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function performLogin(page, provider) {
  log('info', `Login en: ${provider.nombre || 'proveedor'}`);

  try {
    let target = page; // Por defecto trabajar en la pagina principal

    // Si el login esta en un iframe, obtener el frame
    if (provider.login_in_iframe && provider.iframe_selector) {
      log('info', 'Login dentro de iframe, buscando frame...');
      target = await _getIframeContent(page, provider.iframe_selector);
      if (!target) {
        return { success: false, error: 'No se encontro el iframe de login' };
      }
      log('info', 'Iframe encontrado');
    }

    // Esperar a que el campo de usuario este visible
    await target.waitForSelector(provider.selector_user, {
      visible: true,
      timeout: LOGIN_TIMEOUT,
    });

    // Limpiar y llenar campo de usuario
    await _clearAndType(target, provider.selector_user, provider.username);

    // Limpiar y llenar campo de password
    await _clearAndType(target, provider.selector_pass, provider.password);

    // Esperar un momento antes de hacer click en login
    await _sleep(500);

    // Click en boton de login
    await target.click(provider.selector_login_btn);

    // Esperar a que se complete el login (la pagina cambie o se cargue contenido nuevo)
    await _waitForLoginComplete(page, provider);

    log('info', 'Login completado exitosamente');
    return { success: true };
  } catch (err) {
    log('error', `Login fallido: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Verifica si la pagina actual requiere login (busca campos de login comunes).
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
 */
async function needsLogin(page) {
  try {
    return await page.evaluate(() => {
      // Buscar campos de login comunes
      const loginSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[name="passwd"]',
        'input[id*="password"]',
        '#password', '#passwd',
        'form[action*="login"]',
        'form[action*="auth"]',
      ];

      for (const sel of loginSelectors) {
        if (document.querySelector(sel)) return true;
      }

      // Buscar texto que sugiera pagina de login
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const loginKeywords = ['sign in', 'log in', 'iniciar sesion', 'usuario', 'contraseña'];
      for (const kw of loginKeywords) {
        if (bodyText.includes(kw)) return true;
      }

      return false;
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Metodos internos
// ---------------------------------------------------------------------------

/**
 * Obtiene el contenido de un iframe.
 * @private
 */
async function _getIframeContent(page, iframeSelector) {
  try {
    const elementHandle = await page.$(iframeSelector);
    if (!elementHandle) return null;

    const frame = await elementHandle.contentFrame();
    return frame;
  } catch {
    // Intentar por nombre/id
    try {
      const frames = page.frames();
      for (const frame of frames) {
        if (frame.name() && iframeSelector.includes(frame.name())) {
          return frame;
        }
      }
    } catch {}
    return null;
  }
}

/**
 * Limpia un campo y escribe texto.
 * @private
 */
async function _clearAndType(target, selector, text) {
  const element = await target.$(selector);
  if (!element) throw new Error(`Selector no encontrado: ${selector}`);

  // Triple-click para seleccionar todo y luego escribir
  await element.click({ clickCount: 3 });
  await _sleep(100);
  await element.type(text, { delay: 50 }); // Delay entre teclas para simular humano
}

/**
 * Espera a que se complete el login detectando cambios en la pagina.
 * @private
 */
async function _waitForLoginComplete(page, provider) {
  try {
    // Esperar navegacion (si hay redirect post-login)
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: LOGIN_TIMEOUT }),
      _sleep(PAGE_LOAD_WAIT), // Fallback si no hay navegacion
    ]);
  } catch {
    // Timeout en navegacion — puede ser login por AJAX sin redirect
  }

  // Espera adicional para que se cargue el contenido post-login
  await _sleep(PAGE_LOAD_WAIT);

  // Verificar que ya no estamos en la pagina de login
  const stillLogin = await needsLogin(page);
  if (stillLogin) {
    // Puede ser un error de credenciales o carga lenta
    log('warn', 'Todavia en pagina de login, esperando mas...');
    await _sleep(5000);
  }
}

/**
 * Remueve un browser del pool.
 * @private
 */
function _removeFromPool(browser) {
  const idx = browserPool.indexOf(browser);
  if (idx >= 0) {
    browserPool.splice(idx, 1);
  }
  busyBrowsers.delete(browser);
}

/**
 * Sleep helper.
 * @private
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Log con prefijo.
 * @private
 */
function log(level, ...args) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(LOG_PREFIX, ...args);
}

// ---------------------------------------------------------------------------
// Info del pool (para monitoreo)
// ---------------------------------------------------------------------------

/**
 * Retorna el estado actual del pool de browsers.
 * @returns {{total: number, busy: number, available: number, max: number}}
 */
function poolStatus() {
  return {
    total: browserPool.length,
    busy: busyBrowsers.size,
    available: browserPool.length - busyBrowsers.size,
    max: MAX_BROWSERS,
  };
}

// ---------------------------------------------------------------------------
// Exportaciones
// ---------------------------------------------------------------------------

module.exports = {
  acquireBrowser,
  releaseBrowser,
  closeAll,
  createPage,
  navigateTo,
  performLogin,
  needsLogin,
  poolStatus,
};
