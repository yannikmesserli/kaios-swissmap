(function () {
  'use strict';

  var PAN_PIXELS = 80;
  var SWITZERLAND_CENTER = [46.8, 8.2];
  var DEFAULT_ZOOM = 10;
  var TILE_URL = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg';
  var DB_NAME = 'swissmap-tiles';
  var DB_VERSION = 1;
  var STORE_NAME = 'tiles';
  var AREAS_KEY = 'swissmap-offline-areas';

  var db = null;

  function openDB(callback) {
    if (db) { callback(db); return; }
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = function (e) {
      db = e.target.result;
      callback(db);
    };
    req.onerror = function () { callback(null); };
  }

  function storeTile(key, blob) {
    openDB(function (d) {
      if (!d) return;
      var tx = d.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, key);
    });
  }

  function getTile(key, callback) {
    openDB(function (d) {
      if (!d) { callback(null); return; }
      var tx = d.transaction(STORE_NAME, 'readonly');
      var req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = function () { callback(req.result || null); };
      req.onerror = function () { callback(null); };
    });
  }

  function deleteTilesForArea(area, callback) {
    var keys = computeTileKeys(area);
    openDB(function (d) {
      if (!d) { callback(); return; }
      var tx = d.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      var otherAreas = getAreas().filter(function (a) { return a.name !== area.name; });
      var otherKeys = {};
      otherAreas.forEach(function (a) {
        computeTileKeys(a).forEach(function (k) { otherKeys[k] = true; });
      });
      keys.forEach(function (k) {
        if (!otherKeys[k]) store.delete(k);
      });
      tx.oncomplete = function () { callback(); };
      tx.onerror = function () { callback(); };
    });
  }

  function computeTileKeys(area) {
    var keys = [];
    for (var z = area.minZoom; z <= area.maxZoom; z++) {
      var tiles = getTilesInRadius(area.lat, area.lon, area.radius, z);
      tiles.forEach(function (t) {
        keys.push(z + '/' + t.x + '/' + t.y);
      });
    }
    return keys;
  }

  var CachedTileLayer = L.TileLayer.extend({
    createTile: function (coords, done) {
      var tile = document.createElement('img');
      var key = coords.z + '/' + coords.x + '/' + coords.y;
      var url = this.getTileUrl(coords);

      tile.alt = '';
      tile.setAttribute('role', 'presentation');

      getTile(key, function (blob) {
        if (blob) {
          tile.src = URL.createObjectURL(blob);
          done(null, tile);
        } else {
          var xhr = new XMLHttpRequest({ mozSystem: true });
          xhr.open('GET', url);
          xhr.responseType = 'blob';
          xhr.onload = function () {
            if (xhr.status === 200) {
              storeTile(key, xhr.response);
              tile.src = URL.createObjectURL(xhr.response);
              done(null, tile);
            } else {
              done(new Error('Tile fetch failed'), tile);
            }
          };
          xhr.onerror = function () {
            done(new Error('Network error'), tile);
          };
          xhr.send();
        }
      });

      return tile;
    }
  });

  var map = L.map('map', {
    center: SWITZERLAND_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
    attributionControl: false,
    fadeAnimation: false,
    zoomAnimation: false,
    markerZoomAnimation: false,
    inertia: false,
    keyboard: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false
  });

  new CachedTileLayer(TILE_URL, {
    maxZoom: 18,
    minZoom: 7,
    tileSize: 256,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 1
  }).addTo(map);

  var searchOverlay = document.getElementById('search-overlay');
  var searchInput = document.getElementById('search-input');
  var searchResults = document.getElementById('search-results');
  var softkeyLeft = document.getElementById('sk-left');
  var softkeyCenter = document.getElementById('sk-center');
  var softkeyRight = document.getElementById('sk-right');

  var offlineOverlay = document.getElementById('offline-overlay');
  var offlineMenu = document.getElementById('offline-menu');
  var offlineMenuList = document.getElementById('offline-menu-list');
  var offlineDownload = document.getElementById('offline-download');
  var offlineManage = document.getElementById('offline-manage');
  var offlineAreaList = document.getElementById('offline-area-list');
  var noAreasMsg = document.getElementById('no-areas-msg');
  var dlRadiusValue = document.getElementById('dl-radius-value');
  var dlZoomValue = document.getElementById('dl-zoom-value');
  var dlTargetValue = document.getElementById('dl-target-value');
  var dlNameInput = document.getElementById('dl-name-input');
  var dlNameRow = document.getElementById('dl-name-row');
  var dlProgress = document.getElementById('dl-progress');
  var dlProgressFill = document.getElementById('dl-progress-fill');
  var dlProgressText = document.getElementById('dl-progress-text');

  var mode = 'map';
  var results = [];
  var selectedIndex = 0;
  var searchTimeout = null;
  var marker = null;

  // Offline state
  var offlineMode = 'menu'; // menu, download, manage
  var offlineMenuIndex = 0;
  var offlineManageIndex = 0;
  var dlRadius = 2; // km
  var dlMinZoom = 10;
  var dlMaxZoom = 14;
  var dlTargetArea = null; // null = new, or area name
  var dlFocusField = 0; // 0=radius, 1=zoom, 2=target, 3=name
  var downloading = false;

  function getAreas() {
    try {
      return JSON.parse(localStorage.getItem(AREAS_KEY)) || [];
    } catch (e) { return []; }
  }

  function saveAreas(areas) {
    localStorage.setItem(AREAS_KEY, JSON.stringify(areas));
  }

  function updateSoftkeys() {
    if (mode === 'map') {
      softkeyLeft.textContent = 'Search';
      softkeyCenter.textContent = '';
      softkeyRight.textContent = 'Offline';
    } else if (mode === 'search') {
      softkeyLeft.textContent = 'Back';
      softkeyCenter.textContent = results.length ? 'Go' : '';
      softkeyRight.textContent = '';
    } else if (mode === 'offline') {
      if (offlineMode === 'menu') {
        softkeyLeft.textContent = 'Back';
        softkeyCenter.textContent = 'Select';
        softkeyRight.textContent = '';
      } else if (offlineMode === 'download') {
        softkeyLeft.textContent = 'Back';
        softkeyCenter.textContent = downloading ? '' : 'Start';
        softkeyRight.textContent = '';
      } else if (offlineMode === 'manage') {
        softkeyLeft.textContent = 'Back';
        softkeyCenter.textContent = '';
        softkeyRight.textContent = getAreas().length ? 'Delete' : '';
      }
    }
  }

  // Search
  function openSearch() {
    mode = 'search';
    searchOverlay.classList.add('active');
    searchInput.value = '';
    searchResults.innerHTML = '';
    results = [];
    selectedIndex = 0;
    searchInput.focus();
    updateSoftkeys();
  }

  function closeSearch() {
    mode = 'map';
    searchOverlay.classList.remove('active');
    searchInput.blur();
    updateSoftkeys();
  }

  function renderResults() {
    searchResults.innerHTML = '';
    results.forEach(function (r, i) {
      var li = document.createElement('li');
      li.textContent = r.label;
      if (i === selectedIndex) li.classList.add('selected');
      searchResults.appendChild(li);
    });
  }

  function selectResult() {
    if (!results.length) return;
    var r = results[selectedIndex];
    if (marker) map.removeLayer(marker);
    marker = L.marker([r.lat, r.lon]).addTo(map);
    map.setView([r.lat, r.lon], 14);
    closeSearch();
  }

  function doSearch(query) {
    if (!query.trim()) {
      results = [];
      renderResults();
      updateSoftkeys();
      return;
    }
    var url = 'https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=' +
      encodeURIComponent(query) + '&type=locations&limit=10';

    var xhr = new XMLHttpRequest({ mozSystem: true });
    xhr.open('GET', url);
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          results = (data.results || []).map(function (item) {
            var attrs = item.attrs || {};
            return {
              label: attrs.label ? attrs.label.replace(/<[^>]*>/g, '') : 'Unknown',
              lat: attrs.lat,
              lon: attrs.lon
            };
          }).filter(function (r) {
            return r.lat && r.lon;
          });
        } catch (e) {
          results = [];
        }
        selectedIndex = 0;
        renderResults();
        updateSoftkeys();
      }
    };
    xhr.onerror = function () {
      results = [];
      renderResults();
    };
    xhr.send();
  }

  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function () {
      doSearch(searchInput.value);
    }, 500);
  });

  // Offline mode
  function openOffline() {
    mode = 'offline';
    offlineMode = 'menu';
    offlineMenuIndex = 0;
    offlineOverlay.classList.add('active');
    showOfflineMenu();
    updateSoftkeys();
  }

  function closeOffline() {
    mode = 'map';
    offlineOverlay.classList.remove('active');
    offlineMenu.classList.remove('hidden');
    offlineDownload.classList.add('hidden');
    offlineManage.classList.add('hidden');
    dlProgress.classList.add('hidden');
    downloading = false;
    updateSoftkeys();
  }

  function showOfflineMenu() {
    offlineMenu.classList.remove('hidden');
    offlineDownload.classList.add('hidden');
    offlineManage.classList.add('hidden');
    renderOfflineMenu();
  }

  function renderOfflineMenu() {
    var items = offlineMenuList.querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('selected', i === offlineMenuIndex);
    }
  }

  function showDownload() {
    offlineMode = 'download';
    offlineMenu.classList.add('hidden');
    offlineDownload.classList.remove('hidden');
    offlineManage.classList.add('hidden');
    dlRadius = 2;
    dlMinZoom = map.getZoom();
    dlMaxZoom = Math.min(dlMinZoom + 4, 18);
    dlTargetArea = null;
    dlFocusField = 0;
    dlProgress.classList.add('hidden');
    dlNameInput.value = '';
    dlNameRow.classList.remove('hidden');
    downloading = false;
    renderDownloadForm();
    updateSoftkeys();
  }

  function renderDownloadForm() {
    dlRadiusValue.textContent = dlRadius + ' km';
    dlZoomValue.textContent = dlMinZoom + ' - ' + dlMaxZoom;
    var areas = getAreas();
    if (dlTargetArea === null) {
      dlTargetValue.textContent = 'New area';
      dlNameRow.classList.remove('hidden');
    } else {
      dlTargetValue.textContent = dlTargetArea;
      dlNameRow.classList.add('hidden');
    }

    dlRadiusValue.style.fontWeight = dlFocusField === 0 ? 'bold' : 'normal';
    dlZoomValue.style.fontWeight = dlFocusField === 1 ? 'bold' : 'normal';
    dlTargetValue.style.fontWeight = dlFocusField === 2 ? 'bold' : 'normal';

    if (dlFocusField === 3) {
      dlNameInput.focus();
    } else {
      dlNameInput.blur();
    }

    var tileCount = countTiles(dlRadius, dlMinZoom, dlMaxZoom);
    dlProgressText.textContent = '~' + tileCount + ' tiles';
    dlProgress.classList.remove('hidden');
    dlProgressFill.style.width = '0%';
  }

  function countTiles(radius, minZ, maxZ) {
    var center = map.getCenter();
    var total = 0;
    for (var z = minZ; z <= maxZ; z++) {
      total += getTilesInRadius(center.lat, center.lng, radius, z).length;
    }
    return total;
  }

  function getTilesInRadius(lat, lon, radiusKm, zoom) {
    var n = Math.pow(2, zoom);
    var centerX = lonToTileX(lon, n);
    var centerY = latToTileY(lat, n);
    var degPerTile = 360 / n;
    var kmPerDeg = 111.32 * Math.cos(lat * Math.PI / 180);
    var tileRadius = Math.ceil(radiusKm / (degPerTile * kmPerDeg));

    var tiles = [];
    for (var dx = -tileRadius; dx <= tileRadius; dx++) {
      for (var dy = -tileRadius; dy <= tileRadius; dy++) {
        var tx = centerX + dx;
        var ty = centerY + dy;
        if (tx >= 0 && tx < n && ty >= 0 && ty < n) {
          tiles.push({ x: tx, y: ty });
        }
      }
    }
    return tiles;
  }

  function lonToTileX(lon, n) {
    return Math.floor((lon + 180) / 360 * n);
  }

  function latToTileY(lat, n) {
    var rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
  }

  function startDownload() {
    if (downloading) return;
    var name;
    if (dlTargetArea === null) {
      name = dlNameInput.value.trim();
      if (!name) { dlNameInput.focus(); return; }
    } else {
      name = dlTargetArea;
    }

    downloading = true;
    updateSoftkeys();

    var center = map.getCenter();
    var area = {
      name: name,
      lat: center.lat,
      lon: center.lng,
      radius: dlRadius,
      minZoom: dlMinZoom,
      maxZoom: dlMaxZoom
    };

    var allTiles = [];
    for (var z = area.minZoom; z <= area.maxZoom; z++) {
      var tiles = getTilesInRadius(area.lat, area.lon, area.radius, z);
      tiles.forEach(function (t) {
        allTiles.push({ z: z, x: t.x, y: t.y });
      });
    }

    var total = allTiles.length;
    var done = 0;
    var concurrency = 4;
    var index = 0;

    function downloadNext() {
      if (index >= total) {
        if (done >= total) {
          finishDownload(area);
        }
        return;
      }
      var tile = allTiles[index++];
      var key = tile.z + '/' + tile.x + '/' + tile.y;
      var url = TILE_URL.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y);

      getTile(key, function (existing) {
        if (existing) {
          done++;
          updateProgress(done, total);
          downloadNext();
          return;
        }
        var xhr = new XMLHttpRequest({ mozSystem: true });
        xhr.open('GET', url);
        xhr.responseType = 'blob';
        xhr.onload = function () {
          if (xhr.status === 200) {
            storeTile(key, xhr.response);
          }
          done++;
          updateProgress(done, total);
          downloadNext();
        };
        xhr.onerror = function () {
          done++;
          updateProgress(done, total);
          downloadNext();
        };
        xhr.send();
      });
    }

    for (var c = 0; c < concurrency; c++) {
      downloadNext();
    }
  }

  function updateProgress(done, total) {
    var pct = Math.round(done / total * 100);
    dlProgressFill.style.width = pct + '%';
    dlProgressText.textContent = done + '/' + total + ' (' + pct + '%)';
  }

  function finishDownload(area) {
    var areas = getAreas();
    var existing = areas.find(function (a) { return a.name === area.name; });
    if (existing) {
      existing.lat = area.lat;
      existing.lon = area.lon;
      existing.radius = Math.max(existing.radius, area.radius);
      existing.minZoom = Math.min(existing.minZoom, area.minZoom);
      existing.maxZoom = Math.max(existing.maxZoom, area.maxZoom);
    } else {
      areas.push(area);
    }
    saveAreas(areas);
    downloading = false;
    dlProgressText.textContent = 'Done!';
    updateSoftkeys();
  }

  function showManage() {
    offlineMode = 'manage';
    offlineMenu.classList.add('hidden');
    offlineDownload.classList.add('hidden');
    offlineManage.classList.remove('hidden');
    offlineManageIndex = 0;
    renderManageList();
    updateSoftkeys();
  }

  function renderManageList() {
    var areas = getAreas();
    offlineAreaList.innerHTML = '';
    if (!areas.length) {
      noAreasMsg.classList.remove('hidden');
      return;
    }
    noAreasMsg.classList.add('hidden');
    areas.forEach(function (a, i) {
      var li = document.createElement('li');
      li.textContent = a.name + ' (' + a.radius + 'km, z' + a.minZoom + '-' + a.maxZoom + ')';
      if (i === offlineManageIndex) li.classList.add('selected');
      offlineAreaList.appendChild(li);
    });
  }

  function deleteSelectedArea() {
    var areas = getAreas();
    if (!areas.length) return;
    var area = areas[offlineManageIndex];
    deleteTilesForArea(area, function () {
      areas.splice(offlineManageIndex, 1);
      saveAreas(areas);
      offlineManageIndex = Math.max(0, offlineManageIndex - 1);
      renderManageList();
      updateSoftkeys();
    });
  }

  // Key handling for download form
  function handleDownloadKey(key) {
    if (downloading) return;

    if (dlFocusField === 3) {
      // Name input has focus, only handle navigation out
      if (key === 'ArrowUp') {
        dlFocusField = 2;
        renderDownloadForm();
      }
      return;
    }

    var areas = getAreas();
    switch (key) {
      case 'ArrowUp':
        dlFocusField = Math.max(0, dlFocusField - 1);
        renderDownloadForm();
        break;
      case 'ArrowDown':
        var maxField = dlTargetArea === null ? 3 : 2;
        dlFocusField = Math.min(maxField, dlFocusField + 1);
        renderDownloadForm();
        break;
      case 'ArrowLeft':
      case '4':
        if (dlFocusField === 0) dlRadius = Math.max(1, dlRadius - 1);
        else if (dlFocusField === 1) {
          dlMinZoom = Math.max(7, dlMinZoom - 1);
          dlMaxZoom = Math.max(dlMinZoom, dlMaxZoom - 1);
        }
        else if (dlFocusField === 2) {
          var names = [null].concat(areas.map(function (a) { return a.name; }));
          var idx = names.indexOf(dlTargetArea);
          idx = (idx - 1 + names.length) % names.length;
          dlTargetArea = names[idx];
        }
        renderDownloadForm();
        break;
      case 'ArrowRight':
      case '6':
        if (dlFocusField === 0) dlRadius = Math.min(20, dlRadius + 1);
        else if (dlFocusField === 1) {
          dlMaxZoom = Math.min(18, dlMaxZoom + 1);
          dlMinZoom = Math.min(dlMinZoom + 1, dlMaxZoom);
        }
        else if (dlFocusField === 2) {
          var names2 = [null].concat(areas.map(function (a) { return a.name; }));
          var idx2 = names2.indexOf(dlTargetArea);
          idx2 = (idx2 + 1) % names2.length;
          dlTargetArea = names2[idx2];
        }
        renderDownloadForm();
        break;
    }
  }

  // Pan map
  function panMap(dx, dy) {
    map.panBy([dx, dy], { animate: false });
  }

  document.addEventListener('keydown', function (e) {
    var key = e.key;

    if (mode === 'map') {
      switch (key) {
        case '2': panMap(0, -PAN_PIXELS); break;
        case '8': panMap(0, PAN_PIXELS); break;
        case '4': panMap(-PAN_PIXELS, 0); break;
        case '6': panMap(PAN_PIXELS, 0); break;
        case '1': map.zoomOut(1, { animate: false }); break;
        case '3': map.zoomIn(1, { animate: false }); break;
        case 'SoftLeft':
        case 'F1':
          openSearch();
          e.preventDefault();
          break;
        case 'SoftRight':
        case 'F2':
          openOffline();
          e.preventDefault();
          break;
      }
    } else if (mode === 'search') {
      switch (key) {
        case 'SoftLeft':
        case 'F1':
          closeSearch();
          e.preventDefault();
          break;
        case 'Enter':
        case 'SoftRight':
          selectResult();
          e.preventDefault();
          break;
        case 'ArrowDown':
          if (results.length) {
            selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
            renderResults();
          }
          break;
        case 'ArrowUp':
          if (results.length) {
            selectedIndex = Math.max(selectedIndex - 1, 0);
            renderResults();
          }
          break;
      }
    } else if (mode === 'offline') {
      switch (key) {
        case 'SoftLeft':
        case 'F1':
          if (offlineMode === 'menu') {
            closeOffline();
          } else {
            offlineMode = 'menu';
            showOfflineMenu();
            updateSoftkeys();
          }
          e.preventDefault();
          break;
        case 'Enter':
        case 'SoftCenter':
          if (offlineMode === 'menu') {
            if (offlineMenuIndex === 0) showDownload();
            else showManage();
          } else if (offlineMode === 'download') {
            startDownload();
          }
          e.preventDefault();
          break;
        case 'SoftRight':
        case 'F2':
          if (offlineMode === 'manage') {
            deleteSelectedArea();
          }
          e.preventDefault();
          break;
        case 'ArrowDown':
          if (offlineMode === 'menu') {
            offlineMenuIndex = Math.min(1, offlineMenuIndex + 1);
            renderOfflineMenu();
          } else if (offlineMode === 'download') {
            handleDownloadKey(key);
          } else if (offlineMode === 'manage') {
            var aLen = getAreas().length;
            if (aLen) {
              offlineManageIndex = Math.min(offlineManageIndex + 1, aLen - 1);
              renderManageList();
            }
          }
          break;
        case 'ArrowUp':
          if (offlineMode === 'menu') {
            offlineMenuIndex = Math.max(0, offlineMenuIndex - 1);
            renderOfflineMenu();
          } else if (offlineMode === 'download') {
            handleDownloadKey(key);
          } else if (offlineMode === 'manage') {
            offlineManageIndex = Math.max(0, offlineManageIndex - 1);
            renderManageList();
          }
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case '4':
        case '6':
          if (offlineMode === 'download') {
            handleDownloadKey(key);
          }
          break;
      }
    }

    if (key === 'EndCall') {
      e.preventDefault();
      if (mode === 'search') closeSearch();
      else if (mode === 'offline') closeOffline();
    }
  });

  openDB(function () {});
  updateSoftkeys();
})();
