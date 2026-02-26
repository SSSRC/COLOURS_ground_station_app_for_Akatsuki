// 'import type' にすることで、実行時の 'exports' エラーを防ぎます
import type * as Leaflet from 'leaflet';

// HTML側で読み込まれた 'L' を使うことを宣言します
declare const L: typeof Leaflet;

// 地図の初期化
const map = L.map('map').setView([34.545084, 135.503636], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

let marker: Leaflet.Marker;

// 窓口経由でデータを受け取った時の処理
(window as any).electronAPI.onGNSSReceived((rawData: string) => {
    try {
        const parts = rawData.split(' | ');
        const lat = parseFloat(parts[1].split(': ')[1]);
        const lon = parseFloat(parts[2].split(': ')[1]);

        if (!isNaN(lat) && !isNaN(lon)) {
            const newPos: Leaflet.LatLngExpression = [lat, lon];
            if (!marker) {
                marker = L.marker(newPos).addTo(map);
            } else {
                marker.setLatLng(newPos);
            }
            map.panTo(newPos);
        }
    } catch (e) {
        console.error("Data parse error:", e);
    }
});