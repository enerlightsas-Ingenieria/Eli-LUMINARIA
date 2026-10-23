/** HTML de un mapa Leaflet (OpenStreetMap + satélite Esri) sin claves de API; Android e iOS por igual. */
export const MAPA_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{height:100%;margin:0;background:#dfe5ec}
#err{display:none;font:15px sans-serif;padding:24px;text-align:center;color:#444}
.leaflet-popup-content{font:14px sans-serif}</style></head>
<body><div id="m"></div><div id="err">Sin conexión: el mapa necesita internet para cargar. Tus datos siguen guardados.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  if(typeof L==='undefined'){document.getElementById('m').style.display='none';document.getElementById('err').style.display='block';return;}
  var map=L.map('m',{zoomControl:true}).setView([4.65,-74.1],6);
  var osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'});
  var sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri'});
  osm.addTo(map); L.control.layers({'Calles':osm,'Satélite':sat},null,{position:'topright'}).addTo(map);
  var group=L.featureGroup().addTo(map), me=null, first=true;
  function color(t){t=(t||'').toLowerCase();if(t.indexOf('led')>=0)return '#16a34a';if(t.indexOf('sodio')>=0)return '#ea580c';
    if(t.indexOf('mercurio')>=0)return '#2563eb';if(t.indexOf('halide')>=0||t.indexOf('haluro')>=0)return '#9333ea';return '#64748b';}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  window.setData=function(items,fit){
    group.clearLayers();
    items.forEach(function(it){
      var m=L.circleMarker([it.lat,it.lng],{radius:9,color:'#fff',weight:2,fillColor:color(it.tec),fillOpacity:.95}).addTo(group);
      m.bindPopup('<b>'+esc(it.titulo)+'</b><br>'+esc(it.detalle)+'<br><a href="#" onclick="window.ReactNativeWebView.postMessage(JSON.stringify({id:'+it.id+'}));return false">Abrir ficha</a>');
    });
    if(fit&&items.length){map.fitBounds(group.getBounds().pad(.2),{maxZoom:18});}
  };
  window.setMe=function(lat,lng){
    if(me)map.removeLayer(me);
    me=L.circleMarker([lat,lng],{radius:8,color:'#fff',weight:3,fillColor:'#2563eb',fillOpacity:1}).addTo(map);
    map.setView([lat,lng],Math.max(map.getZoom(),17));
  };
  window.ReactNativeWebView.postMessage(JSON.stringify({ready:true}));
})();
true;
</script></body></html>`;

export interface PuntoMapa { id: number; lat: number; lng: number; tec: string; titulo: string; detalle: string }
