/**
 * API Client - Encapsula llamadas a la API .NET (JELA-API-Logistica)
 *
 * Responsabilidades:
 *  - Login y manejo de JWT token (con decodificacion de expiracion real)
 *  - Auto-refresh transparente cuando el token expira
 *  - Proteccion contra logins concurrentes
 *  - CRUD generico (query, insert, update, remove)
 *  - Operaciones bulk (insertMany)
 *  - Proxy a endpoints auxiliares (OpenAI, VAPI webhook)
 *  - Retry automatico en 401 (una vez)
 *  - Wrapping de errores con contexto
 */

'use strict';

const axios = require('axios');

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const API_BASE = process.env.API_BASE_URL
  || 'https://jela-api-logistica-cagfdpfybra4daer.mexicocentral-01.azurewebsites.net';

const DEFAULT_TIMEOUT   = 30000;  // 30s para queries
const MUTATION_TIMEOUT  = 15000;  // 15s para insert/update/delete
const AUTH_TIMEOUT       = 15000;  // 15s para login
const TOKEN_MARGIN_MS    = 5 * 60 * 1000; // 5 min de margen antes de expirar

const LOG_PREFIX = '[ApiClient]';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decodifica el payload de un JWT para extraer la fecha de expiracion.
 * No valida firma — solo necesitamos leer `exp`.
 * @param {string} token
 * @returns {number|null} Timestamp en ms de expiracion, o null si no se pudo leer
 */
function decodeTokenExpiry(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // El payload es la segunda parte, codificada en base64url
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));

    if (decoded.exp && typeof decoded.exp === 'number') {
      return decoded.exp * 1000; // convertir de segundos a ms
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extrae un mensaje de error legible de una respuesta axios.
 * @param {Error} error
 * @returns {string}
 */
function extractErrorMessage(error) {
  if (error.response) {
    const data = error.response.data;
    if (typeof data === 'string') return data;
    if (data?.message) return data.message;
    if (data?.Message) return data.Message;
    return JSON.stringify(data);
  }
  if (error.code === 'ECONNABORTED') return 'Timeout: la solicitud tardo demasiado';
  if (error.code === 'ECONNREFUSED') return 'Conexion rechazada por el servidor';
  return error.message;
}

// ---------------------------------------------------------------------------
// ApiClient
// ---------------------------------------------------------------------------

class ApiClient {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] - URL base de la API (por defecto usa env)
   * @param {boolean} [options.verbose] - Habilitar logs detallados
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || API_BASE;
    this.verbose = options.verbose ?? (process.env.NODE_ENV !== 'production');

    /** @type {string|null} JWT token actual */
    this.token = null;

    /** @type {number|null} Timestamp (ms) de expiracion del token */
    this.tokenExpiry = null;

    /** @type {Promise|null} Promise de login en curso (evita concurrencia) */
    this._refreshPromise = null;

    // Crear instancia axios dedicada con defaults
    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // =========================================================================
  // AUTH
  // =========================================================================

  /**
   * Login contra la API .NET y almacena el JWT token.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{success: boolean, token?: string, error?: string}>}
   */
  async login(username, password) {
    try {
      this._log('info', `Login para usuario "${username}"...`);

      const res = await this.http.post('/api/auth/login', {
        username,
        password,
      }, {
        timeout: AUTH_TIMEOUT,
      });

      // La API puede devolver { token: "..." } o { Token: "..." } o string directo
      const token = res.data?.token || res.data?.Token
        || (typeof res.data === 'string' ? res.data : null);

      if (!token) {
        const msg = 'La respuesta de login no contiene un token valido';
        this._log('error', msg, res.data);
        return { success: false, error: msg };
      }

      this._setToken(token);
      this._log('info', 'Login exitoso. Token expira:', new Date(this.tokenExpiry).toISOString());

      return { success: true, token: this.token };
    } catch (error) {
      const msg = extractErrorMessage(error);
      this._log('error', 'Login fallido:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Establece un token obtenido externamente (p.ej. desde la sesion del usuario).
   * @param {string} token
   */
  setToken(token) {
    this._setToken(token);
  }

  /**
   * Indica si hay un token establecido (no garantiza que sea valido).
   * @returns {boolean}
   */
  get isAuthenticated() {
    return !!this.token;
  }

  /**
   * Indica si el token actual esta proximo a expirar o ya expiro.
   * @returns {boolean}
   */
  get isTokenExpired() {
    if (!this.token || !this.tokenExpiry) return true;
    return Date.now() >= (this.tokenExpiry - TOKEN_MARGIN_MS);
  }

  /**
   * Limpia el token actual (logout).
   */
  clearToken() {
    this.token = null;
    this.tokenExpiry = null;
  }

  /**
   * Asegura que haya un token valido. Si no existe o ya expiro,
   * hace login automatico con las credenciales del .env.
   * Protegido contra llamadas concurrentes.
   * @returns {Promise<void>}
   */
  async ensureToken() {
    // Token vigente: nada que hacer
    if (this.token && !this.isTokenExpired) {
      return;
    }

    // Si ya hay un login en curso, esperar a que termine
    if (this._refreshPromise) {
      await this._refreshPromise;
      return;
    }

    this._log('info', 'Token expirado o ausente — ejecutando auto-login...');

    this._refreshPromise = this._performAutoLogin();

    try {
      await this._refreshPromise;
    } finally {
      this._refreshPromise = null;
    }
  }

  // =========================================================================
  // CRUD GENERICO
  // =========================================================================

  /**
   * Ejecuta un SELECT SQL via el endpoint CRUD generico.
   * Transforma automaticamente el formato {Campos: {field: {Valor, Tipo}}}
   * a formato plano {field: value} para uso facil en el resto del codigo.
   * @param {string} sql - Query SELECT completa
   * @returns {Promise<Array<object>>} Filas resultantes (formato plano)
   */
  async query(sql) {
    const raw = await this._request({
      method: 'GET',
      url: '/api/crud',
      params: { strQuery: sql },
      timeout: DEFAULT_TIMEOUT,
      operation: 'query',
    });

    // Transformar respuesta de formato API .NET a formato plano
    return _flattenRows(raw);
  }

  /**
   * Inserta un registro en la tabla indicada.
   * Convierte automaticamente {field: value} al formato API .NET
   * {campos: {field: {valor: value, tipo: "auto"}}}.
   * @param {string} tabla - Nombre de la tabla (con prefijo cat_, conf_, op_, log_, vw_)
   * @param {object} data - Datos del registro a insertar (formato plano)
   * @returns {Promise<object>} Respuesta de la API
   */
  async insert(tabla, data) {
    return this._request({
      method: 'POST',
      url: `/api/crud/${tabla}`,
      data: _toCrudRequest(data),
      timeout: MUTATION_TIMEOUT,
      operation: 'insert',
    });
  }

  /**
   * Inserta multiples registros en la tabla indicada (secuencial).
   * @param {string} tabla - Nombre de la tabla
   * @param {Array<object>} records - Array de registros
   * @returns {Promise<Array<object>>} Array de respuestas
   */
  async insertMany(tabla, records) {
    if (!Array.isArray(records) || records.length === 0) {
      return [];
    }

    await this.ensureToken();

    const results = [];
    for (const record of records) {
      try {
        const res = await this._requestWithoutEnsure({
          method: 'POST',
          url: `/api/crud/${tabla}`,
          data: _toCrudRequest(record),
          timeout: MUTATION_TIMEOUT,
          operation: 'insertMany',
        });
        results.push({ success: true, data: res });
      } catch (error) {
        results.push({ success: false, error: error.message, record });
      }
    }

    return results;
  }

  /**
   * Actualiza un registro existente.
   * Convierte datos planos al formato API .NET automaticamente.
   * @param {string} tabla - Nombre de la tabla
   * @param {number|string} id - ID del registro
   * @param {object} data - Campos a actualizar (formato plano)
   * @returns {Promise<object>} Respuesta de la API
   */
  async update(tabla, id, data) {
    return this._request({
      method: 'PUT',
      url: `/api/crud/${tabla}/${id}`,
      data: _toCrudRequest(data),
      timeout: MUTATION_TIMEOUT,
      operation: 'update',
    });
  }

  /**
   * Elimina un registro.
   * @param {string} tabla - Nombre de la tabla
   * @param {number|string} id - ID del registro
   * @returns {Promise<object>} Respuesta de la API
   */
  async remove(tabla, id) {
    return this._request({
      method: 'DELETE',
      url: `/api/crud/${tabla}/${id}`,
      timeout: MUTATION_TIMEOUT,
      operation: 'remove',
    });
  }

  // =========================================================================
  // ENDPOINTS AUXILIARES
  // =========================================================================

  /**
   * Envia un prompt a OpenAI via el endpoint proxy de la API .NET.
   * @param {object} payload - Body para /api/openai
   * @returns {Promise<object>} Respuesta de OpenAI
   */
  async openai(payload) {
    return this._request({
      method: 'POST',
      url: '/api/openai',
      data: payload,
      timeout: 60000, // OpenAI puede tardar
      operation: 'openai',
    });
  }

  /**
   * Envia datos al webhook de VAPI (llamadas IA).
   * @param {object} payload - Body para /api/webhooks/vapi
   * @returns {Promise<object>} Respuesta del webhook
   */
  async vapiWebhook(payload) {
    return this._request({
      method: 'POST',
      url: '/api/webhooks/vapi',
      data: payload,
      timeout: DEFAULT_TIMEOUT,
      operation: 'vapiWebhook',
    });
  }

  // =========================================================================
  // METODOS INTERNOS
  // =========================================================================

  /**
   * Metodo central de request con auto-refresh y retry en 401.
   * Todas las operaciones CRUD pasan por aqui para eliminar duplicacion.
   *
   * @param {object} config
   * @param {string} config.method - GET, POST, PUT, DELETE
   * @param {string} config.url - Path relativo
   * @param {object} [config.params] - Query params
   * @param {object} [config.data] - Body
   * @param {number} [config.timeout]
   * @param {string} config.operation - Nombre de la operacion (para logs)
   * @returns {Promise<any>} Response data
   */
  async _request(config) {
    await this.ensureToken();
    return this._requestWithoutEnsure(config);
  }

  /**
   * Request sin ensureToken previo (para uso interno en insertMany, etc.)
   * Incluye retry en 401.
   */
  async _requestWithoutEnsure(config) {
    const { method, url, params, data, timeout, operation } = config;

    const axiosConfig = {
      method,
      url,
      params,
      data,
      timeout: timeout || DEFAULT_TIMEOUT,
      headers: this._getAuthHeaders(),
    };

    try {
      const res = await this.http.request(axiosConfig);
      return res.data;
    } catch (error) {
      // Retry una vez en 401: refrescar token y reintentar
      if (error.response?.status === 401) {
        this._log('warn', `${operation}: 401 recibido, reintentando con token fresco...`);

        this.token = null;
        this.tokenExpiry = null;
        await this.ensureToken();

        axiosConfig.headers = this._getAuthHeaders();
        const res = await this.http.request(axiosConfig);
        return res.data;
      }

      throw this._buildError(operation, error);
    }
  }

  /**
   * Realiza el login automatico con credenciales del .env.
   * @private
   */
  async _performAutoLogin() {
    const username = process.env.API_USERNAME || 'admin';
    const password = process.env.API_PASSWORD || 'Admin2025';

    const result = await this.login(username, password);

    if (!result.success) {
      throw new Error(`${LOG_PREFIX} Auto-login fallido: ${result.error}`);
    }
  }

  /**
   * Almacena el token y calcula su fecha de expiracion.
   * Intenta decodificar el JWT para obtener `exp`; si no puede, asume 8 horas.
   * @param {string} token
   * @private
   */
  _setToken(token) {
    this.token = token;

    const expiry = decodeTokenExpiry(token);
    if (expiry) {
      this.tokenExpiry = expiry;
    } else {
      // Fallback: asumir 8 horas de validez
      this.tokenExpiry = Date.now() + (8 * 60 * 60 * 1000);
    }
  }

  /**
   * Construye los headers de autorizacion.
   * @returns {object}
   * @private
   */
  _getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Envuelve un error de axios con contexto legible.
   * @param {string} operation
   * @param {Error} error
   * @returns {Error}
   * @private
   */
  _buildError(operation, error) {
    const status = error.response?.status || 'ERR';
    const msg = extractErrorMessage(error);
    const wrapped = new Error(`${LOG_PREFIX} ${operation} — HTTP ${status}: ${msg}`);
    wrapped.status = error.response?.status || null;
    wrapped.originalError = error;
    return wrapped;
  }

  /**
   * Log interno con nivel y prefijo.
   * @param {'info'|'warn'|'error'} level
   * @param  {...any} args
   * @private
   */
  _log(level, ...args) {
    if (!this.verbose && level === 'info') return;
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(LOG_PREFIX, ...args);
  }
}

// ---------------------------------------------------------------------------
// Transformadores de formato API .NET ↔ formato plano
// ---------------------------------------------------------------------------

/**
 * Transforma un array de filas del formato API .NET:
 *   [{Campos: {field: {Valor: x, Tipo: y}}}]
 * Al formato plano que usa todo el codigo:
 *   [{field: x}]
 *
 * Si los datos ya estan en formato plano, los retorna sin cambios.
 * @param {Array} rows
 * @returns {Array<object>}
 */
function _flattenRows(rows) {
  if (!Array.isArray(rows)) return rows;
  if (rows.length === 0) return rows;

  // Verificar si la primera fila tiene el wrapper "Campos"
  const first = rows[0];
  if (!first || !first.Campos) {
    // Ya esta en formato plano
    return rows;
  }

  return rows.map(row => {
    if (!row.Campos) return row;

    const flat = {};
    for (const [key, campo] of Object.entries(row.Campos)) {
      flat[key] = campo && typeof campo === 'object' && 'Valor' in campo
        ? campo.Valor
        : campo;
    }
    return flat;
  });
}

/**
 * Convierte un objeto plano {field: value} al formato CrudRequest de la API .NET:
 *   {campos: {field: {valor: value, tipo: "auto"}}}
 *
 * Detecta automaticamente el tipo .NET basado en el tipo JS del valor.
 * @param {object} data - Datos planos
 * @returns {object} CrudRequest
 */
function _toCrudRequest(data) {
  if (!data || typeof data !== 'object') return data;

  // Si ya tiene el formato {campos: ...}, retornar sin cambios
  if (data.campos && typeof data.campos === 'object') return data;

  const campos = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;

    let tipo = 'System.String';
    let valor = value;

    if (value === null) {
      tipo = 'System.String';
      valor = null;
    } else if (typeof value === 'boolean') {
      tipo = 'System.Boolean';
      valor = value;
    } else if (typeof value === 'number') {
      tipo = Number.isInteger(value) ? 'System.Int64' : 'System.Decimal';
      valor = value;
    } else {
      tipo = 'System.String';
      valor = String(value);
    }

    campos[key] = { valor, tipo };
  }

  return { campos };
}

// ---------------------------------------------------------------------------
// Exportaciones
// ---------------------------------------------------------------------------

/**
 * Singleton para uso interno del scraper/scheduler.
 * Usa auto-login con credenciales del .env.
 */
const internalClient = new ApiClient();

/**
 * Factory para crear instancias por usuario (rutas web).
 * @param {string} [token] - JWT token del usuario autenticado
 * @returns {ApiClient}
 */
function createClient(token) {
  const client = new ApiClient();
  if (token) client.setToken(token);
  return client;
}

module.exports = {
  ApiClient,
  internalClient,
  createClient,
};
