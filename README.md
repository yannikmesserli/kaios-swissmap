# SwissMap

A hiking map app for KaiOS feature phones, displaying Swisstopo topographic tiles of Switzerland.

## Features

- Swisstopo color pixel map tiles via WMTS
- D-pad navigation: pan with 2/4/6/8, zoom with 1/3
- Location search using the geo.admin.ch API
- Crosshair center marker
- Optimized for 240x320 non-touch screens

## Controls

| Key | Action |
|-----|--------|
| 2 / 4 / 6 / 8 | Pan up / left / right / down |
| 1 | Zoom out |
| 3 | Zoom in |
| SoftLeft | Open search |
| Enter | Select search result |

## Running

Sideload on a KaiOS device or use the [KaiOS simulator](https://developer.kaiostech.com/docs/sfp-3.0/getting-started/env-setup/simulator). The app requires the `systemXHR` permission for cross-origin tile and API requests.

## Dependencies

- [Leaflet](https://leafletjs.com/) 1.9.4 (loaded from CDN)

## Data Sources

- Map tiles: [Swisstopo WMTS](https://www.swisstopo.admin.ch/)
- Search: [geo.admin.ch SearchServer API](https://api3.geo.admin.ch/)
