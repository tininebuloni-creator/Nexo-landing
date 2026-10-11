/* ============================================================================
 * leaflet-map.js
 * Módulo reutilizable para inicializar un mapa Leaflet en cualquier HTML.
 *
 * Requisitos en el HTML host:
 *   <link rel="stylesheet"
 *         href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
 *   <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
 *   <div id="map" style="width:100%;height:500px;"></div>
 *   <script src="leaflet-map.js"></script>
 *
 * Configuración (opcional): definir ANTES de cargar el script:
 *   <script>
 *     window.LeafletMapConfig = {
 *       containerId: 'map',
 *       center: [-34.6037, -58.3816],   // [lat, lng]
 *       zoom: 12,
 *       minZoom: 3,
 *       maxZoom: 19,
 *       geolocate: true,                // pide ubicación al usuario
 *       defaultLayer: 'OpenStreetMap',
 *       markers: [
 *         { lat: -34.6037, lng: -58.3816, title: 'Obelisco',
 *           popup: '<b>Obelisco</b><br>CABA' }
 *       ],
 *       geojson: null                   // objeto GeoJSON o URL string
 *     };
 *   </script>
 *
 * También puede configurarse por data-attributes en el contenedor:
 *   <div id="map" data-lat="-34.6" data-lng="-58.38" data-zoom="12"
 *        data-geolocate="true" data-geojson-url="/rutas.geojson"></div>
 *
 * API pública expuesta (para todas las apps):
 *   window.LeafletApp.map                -> instancia Leaflet
 *   window.LeafletApp.addMarker(opts)
 *   window.LeafletApp.addGeoJSON(data, opts)
 *   window.LeafletApp.locate()
 *   window.LeafletApp.refresh()          -> invalidateSize (fix render)
 *   window.LeafletApp.reset()            -> destruye y regenera el mapa
 * ==========================================================================*/
(function (global) {
  'use strict';

  // ---------- Configuración por defecto -------------------------------------
  var DEFAULTS = {
    containerId: 'map',
    center: [0, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 19,
    geolocate: false,
    geolocateOptions: { setView: true, maxZoom: 15, enableHighAccuracy: true },
    defaultLayer: 'OpenStreetMap',
    showLayerControl: true,
    showScale: true,
    markers: [],
    geojson: null,
    geojsonStyle: {
      color: '#2b6cb0',
      weight: 3,
      opacity: 0.85,
      fillColor: '#63b3ed',
      fillOpacity: 0.25
    }
  };

  // ---------- Utilidades -----------------------------------------------------
  function log(msg, err) {
    if (err) { console.error('[leaflet-map] ' + msg, err); }
    else { console.log('[leaflet-map] ' + msg); }
  }

  function mergeConfig(base, override) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    if (override) {
      Object.keys(override).forEach(function (k) {
        if (override[k] !== undefined && override[k] !== null) out[k] = override[k];
      });
    }
    return out;
  }

  function readDataAttrs(el) {
    if (!el || !el.dataset) return {};
    var d = el.dataset;
    var cfg = {};
    if (d.lat && d.lng) cfg.center = [parseFloat(d.lat), parseFloat(d.lng)];
    if (d.zoom)         cfg.zoom = parseInt(d.zoom, 10);
    if (d.minZoom)      cfg.minZoom = parseInt(d.minZoom, 10);
    if (d.maxZoom)      cfg.maxZoom = parseInt(d.maxZoom, 10);
    if (d.geolocate)    cfg.geolocate = d.geolocate === 'true';
    if (d.defaultLayer) cfg.defaultLayer = d.defaultLayer;
    if (d.geojsonUrl)   cfg.geojson = d.geojsonUrl;
    return cfg;
  }

  // ---------- Capas base ----------------------------------------------------
  function buildBaseLayers() {
    var L = global.L;
    return {
      'OpenStreetMap': L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }
      ),
      'Satélite (Esri)': L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
      ),
      'Topográfico (OpenTopoMap)': L.tileLayer(
        'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        { attribution: 'Map data: &copy; OpenStreetMap, SRTM | &copy; OpenTopoMap (CC-BY-SA)',
          maxZoom: 17 }
      ),
      'Oscuro (CartoDB)': L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { attribution: '&copy; OpenStreetMap &copy; CartoDB', maxZoom: 19 }
      )
    };
  }

  // ---------- Núcleo: creación del mapa -------------------------------------
  function createMap(cfg) {
    var L = global.L;
    if (!L) { log('Leaflet (window.L) no está cargado.', true); return null; }

    var container = document.getElementById(cfg.containerId);
    if (!container) {
      log('No se encontró #' + cfg.containerId + ' en el DOM.', true);
      return null;
    }

    // Si el contenedor ya tiene un mapa (recarga/hot reload), lo desmontamos.
    if (container._leaflet_id) {
      try { container._leaflet_map && container._leaflet_map.remove(); } catch (e) {}
      container.innerHTML = '';
    }

    var map = L.map(container, {
      center: cfg.center,
      zoom: cfg.zoom,
      minZoom: cfg.minZoom,
      maxZoom: cfg.maxZoom,
      worldCopyJump: true
    });
    container._leaflet_map = map;

    // Capas base
    var baseLayers = buildBaseLayers();
    var initial = baseLayers[cfg.defaultLayer] || baseLayers['OpenStreetMap'];
    initial.addTo(map);

    if (cfg.showLayerControl) {
      L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
    }
    if (cfg.showScale) {
      L.control.scale({ imperial: false }).addTo(map);
    }

    // Marcadores iniciales
    (cfg.markers || []).forEach(function (m) { addMarker(map, m); });

    // GeoJSON inicial
    if (cfg.geojson) loadGeoJSON(map, cfg.geojson, cfg.geojsonStyle);

    // Geolocalización
    if (cfg.geolocate) {
      map.locate(cfg.geolocateOptions);
      map.on('locationfound', function (e) {
        L.circle(e.latlng, { radius: e.accuracy, color: '#3182ce',
          fillColor: '#63b3ed', fillOpacity: 0.15 }).addTo(map);
        L.marker(e.latlng).addTo(map).bindPopup('Estás aquí').openPopup();
      });
      map.on('locationerror', function (err) {
        log('Geolocalización no disponible: ' + err.message);
      });
    }

    // Fix clásico: mapa gris cuando el contenedor cambia de tamaño / está oculto
    setTimeout(function () { map.invalidateSize(); }, 100);
    global.addEventListener('resize', function () { map.invalidateSize(); });

    return map;
  }

  // ---------- Helpers de API ------------------------------------------------
  function addMarker(map, opts) {
    var L = global.L;
    if (!map || !opts || opts.lat == null || opts.lng == null) return null;
    var mk = L.marker([opts.lat, opts.lng], { title: opts.title || '' }).addTo(map);
    if (opts.popup) mk.bindPopup(opts.popup);
    if (opts.tooltip) mk.bindTooltip(opts.tooltip);
    return mk;
  }

  function loadGeoJSON(map, source, style) {
    var L = global.L;
    var applyLayer = function (data) {
      L.geoJSON(data, {
        style: style,
        onEachFeature: function (feature, layer) {
          if (feature.properties) {
            var html = Object.keys(feature.properties)
              .map(function (k) { return '<b>' + k + ':</b> ' + feature.properties[k]; })
              .join('<br>');
            if (html) layer.bindPopup(html);
          }
        }
      }).addTo(map);
    };

    if (typeof source === 'string') {
      fetch(source)
        .then(function (r) { return r.json(); })
        .then(applyLayer)
        .catch(function (e) { log('Error cargando GeoJSON: ' + source, e); });
    } else if (typeof source === 'object') {
      applyLayer(source);
    }
  }

  // ---------- Bootstrap -----------------------------------------------------
  function init() {
    var userCfg = global.LeafletMapConfig || {};
    var containerId = userCfg.containerId || DEFAULTS.containerId;
    var el = document.getElementById(containerId);
    var dataCfg = readDataAttrs(el);
    var cfg = mergeConfig(mergeConfig(DEFAULTS, dataCfg), userCfg);

    var map = createMap(cfg);
    if (!map) return;

    global.LeafletApp = {
      map: map,
      config: cfg,
      addMarker: function (opts) { return addMarker(map, opts); },
      addGeoJSON: function (data, style) {
        return loadGeoJSON(map, data, style || cfg.geojsonStyle);
      },
      locate: function (opts) { map.locate(opts || cfg.geolocateOptions); },
      refresh: function () { map.invalidateSize(); },
      reset: function (newCfg) {
        try { map.remove(); } catch (e) {}
        var merged = mergeConfig(cfg, newCfg || {});
        global.LeafletMapConfig = merged;
        init();
      }
    };

    log('Mapa inicializado en #' + cfg.containerId);
  }
  // 🟢 REEMPLAZO AUTOMÁTICO SANEADO: Esperar a que la app inyecte el #map en el DOM
  // 🟢 INTENTAR INICIALIZAR EL MAPA EN CUALQUIER CONTENEDOR DISPONIBLE
  function bootstrap() {
    // 1. Buscar el ID configurado por defecto ('map')
    var containerId = (global.LeafletMapConfig && global.LeafletMapConfig.containerId) || 'map';
    var el = document.getElementById(containerId);
    
    // 2. EL TRUCO SUPREMO: Si no encuentra #map, busca cualquier DIV que use la app para el mapa
    if (!el) {
      el = document.querySelector('[id*="map"]') || document.querySelector('.leaflet-container');
      if (el && el.id) {
        cfg.containerId = el.id; // Corregimos la ruta dinámicamente si la app nombró el div de otra forma
      }
    }

    // 3. Si el elemento ya apareció en la pantalla, disparamos el mapa al instante
    if (el) {
      init();
      // Forzar el reajuste clásico de píxeles para que no se vea cortado o en pedazos
      setTimeout(function () {
        if (global.LeafletApp && global.LeafletApp.map) {
          global.LeafletApp.map.invalidateSize();
        }
      }, 250);
    } else {
      // Si la app tarda mucho en renderizar la pantalla, reintentar en 400ms
      setTimeout(bootstrap, 400);
    }
  }

  // Lanzar el arranque seguro
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  
// ============================================================================
// ⏱️ CONTROL AUTOMÁTICO DE TRIALS WEB PARA EL CATÁLOGO
// ============================================================================
(function() {
  // 1. Revisar si la URL de la Landing viene con los parámetros de prueba
  var urlParams = new URLSearchParams(window.location.search);
  var esModoTrial = urlParams.get('modo') === 'trial';
  var diasConfigurados = parseInt(urlParams.get('dias'), 10) || 30;

  if (esModoTrial) {
    console.log('[pampa-trial] 🚀 Modo Simulación Web Activo: ' + diasConfigurados + ' días.');

    // 2. Si es la primera vez que entra en la sesión, fijar la fecha de inicio
    if (!sessionStorage.getItem('pampa_trial_init')) {
      sessionStorage.setItem('pampa_trial_init', new Date().toISOString());
    }

    // 3. Forzar que tu cartel azul existente muestre los días reales de la URL
    var cartelAzul = document.querySelector('.cartel-azul-trial') || document.getElementById('cartel-trial');
    if (cartelAzul) {
      cartelAzul.style.display = 'flex'; // Asegura que se vea el cartel azul
      cartelAzul.innerHTML = '⏱️ <b>Periodo de Prueba Activo:</b> Te quedan <b>' + diasConfigurados + ' días</b> de simulación local.';
    }

    // 4. Forzar que salte tu aviso de privacidad de datos existente al arrancar
    var avisoPrivacidad = document.querySelector('.aviso-privacidad') || document.getElementById('modal-privacidad');
    if (avisoPrivacidad) {
      avisoPrivacidad.style.display = 'block';
    }
  }
})();

})(window);
