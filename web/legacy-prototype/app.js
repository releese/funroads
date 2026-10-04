/* FunRoads UI: intentionally dependency-light except MapLibre/uPlot CDNs. */
(() => {
  "use strict";
  const data = window.__FUNROADS__ || {};
  const routes = Array.isArray(data.routes) ? data.routes : [];
  const comps = ["corners","flow","quiet","speed","elevation","surface","scenery"];
  const labels = {corners:"Corners",flow:"Flow",quiet:"Quiet",speed:"Speed",elevation:"Elevation",surface:"Surface",scenery:"Scenery"};
  const defaultWeights = {corners:22,flow:17,quiet:13,speed:12,elevation:10,surface:13,scenery:13};
  let weights = {...defaultWeights}, selected = null, focused = 0, map, chart, comet, profileHover = false, topOn = false;
  const $ = s => document.querySelector(s), esc = s => String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const line = r => ({type:"Feature",properties:{id:r.id},geometry:{type:"LineString",coordinates:r.line || []}});
  const score = r => comps.reduce((n,k) => n + (+r.score?.[k] || 0) * weights[k], 0) / 100;
  const motionOK = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const icon = type => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${type==="camera"?"M4 7h4l2-2h4l2 2h4v12H4zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6":type==="bump"?"M3 16c4-9 14-9 18 0M3 19h18":type==="town"?"M4 20V9l5-4v15m0 0V3l6 4v13m0 0v-9l5 3v6":type==="cyclists"?"M7 18a4 4 0 1 1 0-8 4 4 0 0 1 0 8m10 0a4 4 0 1 1 0-8 4 4 0 0 1 0 8M8 9l4-4 3 5h-5l3 3":type==="motorcycle_ban"?"M4 4l16 16M5 14h14l-2-5h-6l-2 5": "M4 10h16v10H4zM8 10V7a4 4 0 0 1 8 0v3" }"/></svg>`;
  function filters() {
    return [...document.querySelectorAll(".chip.active")].map(x => x.dataset);
  }
  function visible(r) {
    const fs = filters(); if (!fs.length) return true;
    return fs.every(f => f.kind === "distance" ? (f.val==="short"?r.km<60:f.val==="medium"?r.km>=60&&r.km<=90:r.km>90) :
      f.kind === "reach" ? (+r.reach_min||999)<=+f.val : f.kind === "quiet" ? (+r.score?.quiet||0)>=75 :
      f.kind === "area" ? r.area_id===f.val : true);
  }
  function header() {
    return `<div class="brand"><div><h1>${esc(data.meta?.title || "FunRoads")}</h1><p>${esc(data.meta?.tagline || "Spirited Sunday circuits")}</p></div><span class="generated">${esc((data.meta?.generated||"").slice(0,10))}</span></div>`;
  }
  function overview() {
    selected = null; $("#drawer").classList.remove("open"); removeMarkers();
    $("#sidebar-content").innerHTML = header()+`<div class="section-title">Scoring rubric</div><div class="controls">${comps.map(k=>`<label class="weight">${labels[k]}<input data-weight="${k}" type="range" min="0" max="40" value="${weights[k]}"><b>${weights[k]}%</b></label>`).join("")}<button class="reset">Reset weights</button></div>
    <div class="section-title">Explore</div><label class="toggle"><input id="toproads" type="checkbox" ${topOn?"checked":""}> Top roads nationally</label>
    <div class="filters">${["short","medium","long"].map(v=>`<button class="chip" data-kind="distance" data-val="${v}">${v}</button>`).join("")}${(data.areas||[]).map(a=>`<button class="chip" data-kind="area" data-val="${esc(a.id)}">${esc(a.name)}</button>`).join("")}${[45,60,90].map(v=>`<button class="chip" data-kind="reach" data-val="${v}">≤${v}m reach</button>`).join("")}<button class="chip" data-kind="quiet" data-val="quiet">quiet ≥75</button></div>
    <div class="section-title">Ranked circuits</div><div id="cards"></div>`;
    bindOverview(); renderCards(); updateMap();
  }
  function renderCards() {
    const rs=routes.filter(visible).sort((a,b)=>score(b)-score(a));
    $("#cards").innerHTML=rs.length?rs.map(r=>`<article class="card ${r.id===selected?"selected":""}" tabindex="0" data-id="${esc(r.id)}"><strong class="score" data-target="${score(r).toFixed(1)}">${score(r).toFixed(1)}</strong><h2>${esc(r.name)}</h2><div class="muted">${esc(r.area_name)}</div><div class="facts"><span>${(+r.km||0).toFixed(1)} km</span><span>${r.drive_min||"—"} min drive</span><span>${r.reach_min==null?"—":r.reach_min+" min reach"}</span></div><div class="bar"><i style="width:${score(r)}%"></i></div><div class="cornerchips"><span>${r.corner_count?.tight||0} tight</span><span>${r.corner_count?.sweet||0} sweet</span><span>${r.corner_count?.flowing||0} flowing</span></div><div class="why">${esc((r.why||[])[0]||"A spirited circuit")}</div></article>`).join(""):`<div class="empty">No circuits match these filters.</div>`;
    document.querySelectorAll(".card").forEach(card => {
      const r=routes.find(x=>x.id===card.dataset.id);
      card.onmouseenter=e=>highlight(r,e); card.onmouseleave=clearHighlight;
      card.onclick=()=>detail(r); card.onkeydown=e=>{if(e.key==="Enter") detail(r)};
    });
  }
  function bindOverview() {
    document.querySelectorAll("[data-weight]").forEach(el=>el.oninput=()=>{weights[el.dataset.weight]=+el.value; let sum=comps.reduce((n,k)=>n+weights[k],0); comps.forEach(k=>weights[k]=Math.round(weights[k]*100/sum)); document.querySelectorAll("[data-weight]").forEach(x=>{x.value=weights[x.dataset.weight];x.nextElementSibling.textContent=weights[x.dataset.weight]+"%"}); renderCards(); updateMap();});
    $(".reset").onclick=()=>{weights={...defaultWeights};overview()};
    document.querySelectorAll(".chip").forEach(x=>x.onclick=()=>{x.classList.toggle("active");renderCards();updateMap()});
    $("#toproads").onchange=e=>{topOn=e.target.checked;updateMap()};
  }
  function radar(r) {
    const vals=comps.map(k=>+r.score?.[k]||0), pts=vals.map((v,i)=>{let a=-Math.PI/2+i*2*Math.PI/7, z=.62*v/100;return `${75+Math.cos(a)*z*70},${75+Math.sin(a)*z*70}`}).join(" ");
    return `<svg class="radar" viewBox="0 0 150 150"><polygon points="75,5 130,32 143,93 105,140 45,140 7,93 20,32" fill="#1b2432" stroke="#455166"/><polygon points="${pts}" fill="#d5001c55" stroke="#ff5368" stroke-width="2"/>${comps.map((k,i)=>{let a=-Math.PI/2+i*2*Math.PI/7;return `<text x="${75+Math.cos(a)*68}" y="${78+Math.sin(a)*68}" fill="#b5bdcc" font-size="8" text-anchor="middle">${labels[k]}</text>`}).join("")}</svg>`;
  }
  function detail(r) {
    if(!r)return; selected=r; const links=r.links||{};
    $("#sidebar-content").innerHTML=`<button class="back">← All circuits</button><div class="detail-head"><div><h2>${esc(r.name)}</h2><div class="muted">${esc(r.area_name)} · ${r.km||0} km · ${r.drive_min||"—"} min</div></div></div>${radar(r)}<div class="section-title">Why it’s fun</div><ul class="detail-list">${(r.why||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul><div class="section-title">Roads</div>${(r.roads||[]).map(x=>`<div class="road"><span>${esc(x.name)}</span><span>${x.km||0} km · ${x.fun||0}</span></div>`).join("")}<div class="section-title">Stops & warnings</div>${(r.stops||[]).map(x=>`<div class="warning">${icon(x.type)}<span><b>${esc(x.name||x.type)}</b> ${esc(x.note||"")}</span></div>`).join("")}<div class="exports">${links.gpx?`<a href="${esc(links.gpx)}" download>GPX</a>`:""}${links.kml?`<a href="${esc(links.kml)}" download>KML</a>`:""}${links.gmaps?`<a href="${esc(links.gmaps)}" target="_blank" rel="noopener">Google Maps</a>`:""}</div>`;
    $(".back").onclick=overview; addMarkers(r); drawProfile(r); fly(r); updateMap(); countNumbers();
  }
  function countNumbers(){if(!motionOK)return; document.querySelectorAll("[data-target]").forEach(e=>{const n=+e.dataset.target;let t=performance.now();(function f(now){let p=Math.min(1,(now-t)/600);e.textContent=(n*(1-(1-p)**3)).toFixed(1);if(p<1)requestAnimationFrame(f)})(t)})}
  function initMap() {
    const center=[data.home?.lon||5.2,data.home?.lat||52.15], styles=["https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json","https://tiles.openfreemap.org/styles/dark","https://demotiles.maplibre.org/style.json"];
    let n=0;
    const start=()=>{map=new maplibregl.Map({container:"map",style:styles[n],center,zoom:7.1,attributionControl:false});map.addControl(new maplibregl.NavigationControl(),"bottom-right");
      map.on("error",e=>{if(e.error?.sourceId||n>=styles.length-1)return; n++; map.setStyle(styles[n]); if(n===styles.length-1)$("#map-message").hidden=false});
      // Keep the route browser useful while a remote basemap is loading or unavailable.
      overview();
      map.on("load",()=>{addSources();updateMap();});};
    if(window.maplibregl)start(); else $("#map-message").textContent="map library unavailable — routes still listed",$("#map-message").hidden=false;
  }
  function addSources() {
    map.addSource("routes",{type:"geojson",data:{type:"FeatureCollection",features:routes.map(line)}});
    map.addSource("top",{type:"geojson",data:{type:"FeatureCollection",features:(data.toproads||[]).map(x=>({type:"Feature",properties:x,geometry:{type:"LineString",coordinates:x.line||[]}}))}});
    map.addLayer({id:"top",type:"line",source:"top",paint:{"line-color":"#728096","line-width":1,"line-opacity":0}});
    map.addLayer({id:"route-glow",type:"line",source:"routes",paint:{"line-color":"#d5001c","line-width":8,"line-blur":5,"line-opacity":0}});
    map.addLayer({id:"route-lines",type:"line",source:"routes",paint:{"line-color":"#bd394b","line-width":3,"line-opacity":.62}});
    ["route-lines","route-glow"].forEach(id=>{map.on("mouseenter",id,e=>{map.getCanvas().style.cursor="pointer";let r=routes.find(x=>x.id===e.features?.[0]?.properties.id);highlight(r,e.originalEvent)});map.on("mouseleave",id,clearHighlight);map.on("click",id,e=>detail(routes.find(x=>x.id===e.features?.[0]?.properties.id)))});
  }
  function updateMap() {
    if(!map?.getLayer("route-lines"))return;
    const show=routes.filter(visible).map(line); map.getSource("routes").setData({type:"FeatureCollection",features:show});
    map.setPaintProperty("top","line-opacity",topOn?.28:0);
    if(selected) { const features=[];(selected.seg||[]).forEach(s=>features.push({type:"Feature",properties:{fun:s.fun||0},geometry:{type:"LineString",coordinates:(selected.line||[]).slice(s.i0,s.i1+1)}})); if(!features.length)features.push(line(selected)); if(map.getSource("segments")){map.getSource("segments").setData({type:"FeatureCollection",features});}else{map.addSource("segments",{type:"geojson",data:{type:"FeatureCollection",features}});map.addLayer({id:"segments",type:"line",source:"segments",paint:{"line-color":["interpolate",["linear"],["get","fun"],0,"#496276",40,"#278b95",60,"#d0af42",80,"#ed742e",100,"#d5001c"],"line-width":6,"line-opacity":.95}})}}
  }
  function highlight(r,e) {if(!r||selected)return;map?.setFilter("route-glow",["==",["get","id"],r.id]);map?.setPaintProperty("route-glow","line-opacity",.5);map?.setPaintProperty("route-lines","line-opacity",["case",["==",["get","id"],r.id],1,.18]);document.querySelector(`.card[data-id="${r.id}"]`)?.classList.add("focused");let t=$("#tip");t.style.display="block";t.style.left=((e?.clientX||0)+14)+"px";t.style.top=((e?.clientY||0)+14)+"px";t.textContent=`${r.name} · ${r.km} km · ${score(r).toFixed(1)}`;}
  function clearHighlight(){if(selected)return;map?.setPaintProperty("route-glow","line-opacity",0);map?.setPaintProperty("route-lines","line-opacity",.62);document.querySelectorAll(".card").forEach(x=>x.classList.remove("focused"));$("#tip").style.display="none";}
  function fly(r){let cs=r.line||[];if(!cs.length)return;let b=cs.reduce((a,c)=>a.extend(c),new maplibregl.LngLatBounds(cs[0],cs[0]));let dx=cs[1]?.[0]-cs[0][0],dy=cs[1]?.[1]-cs[0][1];map.fitBounds(b,{padding:{left:430,right:70,top:70,bottom:270},pitch:50,bearing:Math.atan2(dx,dy)*180/Math.PI,duration:motionOK?1000:0});}
  function removeMarkers(){[comet,...document.querySelectorAll(".marker")].filter(Boolean).forEach(x=>x.remove?.());comet=null;}
  function addMarkers(r){removeMarkers();let st=r.start||{},cs=r.line||[],mk=(cls,html,coord)=>new maplibregl.Marker({element:Object.assign(document.createElement("div"),{className:cls+" marker",innerHTML:html||""})}).setLngLat(coord).addTo(map);if(st.lon!=null)mk("start-pin","",[st.lon,st.lat]);(r.corners||[]).forEach(c=>mk("corner-pin",esc(c.dir||""),[c.lon,c.lat]));(r.stops||[]).filter(x=>x.type==="coffee").forEach(x=>mk("stop-pin",icon("coffee"),[x.lon,x.lat]));if(!cs.length)return;comet=mk("comet","",cs[0]);let began=performance.now();(function drive(now){if(!selected||selected.id!==r.id||!comet)return;let p=((now-began)%18000)/18000*(cs.length-1),a=cs[Math.floor(p)],b=cs[Math.min(cs.length-1,Math.ceil(p))],f=p%1; if(!profileHover&&a&&b)comet.setLngLat([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]);requestAnimationFrame(drive)})(began);}
  function drawProfile(r){let ev=r.elev||[];if(!ev.length||!window.uPlot){$("#drawer").classList.remove("open");return}$("#drawer").classList.add("open");$("#profile-head").innerHTML=`<div class="profile-title">${esc(r.name)} profile</div><div class="profile-stat">climb +${r.climb_m||0} m · elevation, curvature & speed limit</div>`;$("#chart").innerHTML="";let x=ev.map(p=>p[0]), y=ev.map(p=>p[1]),cur=(r.curv||[]).map(p=>p[1]*20+(Math.min(...y)-15)), speed=x.map(k=>{let i=(r.seg||[]).find(s=>k<=((r.elev||[])[s.i1]?.[0]||999));return i?.lim||0});chart=new uPlot({width:$("#chart").clientWidth,height:150,series:[{}, {label:"Elevation",stroke:"#d5001c",fill:"#d5001c44",width:2},{label:"Curvature",stroke:"#25a9a1",fill:"#25a9a133",width:1},{label:"Limit",stroke:"#d0af42",width:1}],axes:[{label:"km"},{},{}],cursor:{drag:{setScale:false}},hooks:{setCursor:[u=>{let i=u.cursor.idx;if(i!=null&&selected?.line?.length){profileHover=true;let p=selected.line[Math.round(i/(x.length-1)*(selected.line.length-1))];if(p)comet?.setLngLat(p)}}]}},[x,y,cur,speed],$("#chart"));}
  $("#drawer-close").onclick=()=>$("#drawer").classList.remove("open");
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&selected)overview();if(["ArrowUp","ArrowDown"].includes(e.key)&&!selected){e.preventDefault();let cards=[...document.querySelectorAll(".card")];focused=Math.max(0,Math.min(cards.length-1,focused+(e.key==="ArrowUp"?-1:1)));cards[focused]?.focus();}});
  initMap();
})();
