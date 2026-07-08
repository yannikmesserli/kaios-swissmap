(function () {
  'use strict';

  var PAN_PIXELS = 80;
  var SWITZERLAND_CENTER = [46.8, 8.2];
  var DEFAULT_ZOOM = 10;

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

  L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', {
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

  var mode = 'map';
  var results = [];
  var selectedIndex = 0;
  var searchTimeout = null;
  var marker = null;

  function updateSoftkeys() {
    if (mode === 'map') {
      softkeyLeft.textContent = 'Search';
      softkeyCenter.textContent = '';
      softkeyRight.textContent = '';
    } else if (mode === 'search') {
      softkeyLeft.textContent = 'Back';
      softkeyCenter.textContent = results.length ? 'Go' : '';
      softkeyRight.textContent = '';
    }
  }

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
        case 'Enter':
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
    }

    if (key === 'EndCall') {
      e.preventDefault();
      if (mode === 'search') closeSearch();
    }
  });

  updateSoftkeys();
})();
