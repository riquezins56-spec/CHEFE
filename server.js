const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const os = require('os');
const { Pool } = require('pg');

const DEFAULT_PORT = Number(process.env.PORT || 3000);
let PORT = DEFAULT_PORT;
const ROOT = __dirname;
const DB = path.join(ROOT, 'data.json');

const seed = {
  categories: ['Hambúrgueres','Pizzas','Combos','Bebidas','Açaí na Garrafa'],
  settings: {
    name: 'CHEFE TELLES',
    whatsapp: '5573982451160',
    adminPassword: '1234',
    autoPrint: true,
    printerPort: 'COM11',
    printerBaud: 9600
  },
  products: [
    {id:1,name:'X-Bacon',cat:'Hambúrgueres',price:29.90,emoji:'🍔',desc:'Pão brioche, burger artesanal, queijo, bacon crocante e molho da casa.',image:'',active:true},
    {id:2,name:'X-Salada',cat:'Hambúrgueres',price:26.90,emoji:'🍔',desc:'Burger artesanal, queijo, alface, tomate e molho especial.',image:'',active:true},
    {id:3,name:'X-Tudo',cat:'Hambúrgueres',price:34.90,emoji:'🍔',desc:'Burger, queijo, bacon, calabresa, ovo, salada e molho.',image:'',active:true},
    {id:4,name:'Combo X-Bacon',cat:'Combos',price:39.90,emoji:'🍟',desc:'X-Bacon + batata frita crocante + refrigerante lata.',image:'',active:true},
    {id:5,name:'Combo X-Tudo',cat:'Combos',price:44.90,emoji:'🍟',desc:'X-Tudo + batata frita crocante + refrigerante lata.',image:'',active:true},
    {id:6,name:'Pizza Calabresa',cat:'Pizzas',price:39.90,emoji:'🍕',desc:'Molho de tomate, muçarela, calabresa e cebola.',image:'',active:true},
    {id:7,name:'Pizza Frango com Catupiry',cat:'Pizzas',price:44.90,emoji:'🍕',desc:'Frango desfiado, muçarela e catupiry cremoso.',image:'',active:true},
    {id:8,name:'Pizza 4 Queijos',cat:'Pizzas',price:46.90,emoji:'🍕',desc:'Muçarela, provolone, parmesão e catupiry.',image:'',active:true},
    {id:9,name:'Coca-Cola Lata',cat:'Bebidas',price:6,emoji:'🥤',desc:'Refrigerante 350ml bem gelado.',image:'',active:true}
  ],
  deliveryZones: [],
  deliveryKmRanges: [],
  drivers: [],
  orders: []
};

const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : {rejectUnauthorized:false}
}) : null;

let dbReadyPromise=null;
async function ensureDb(){
  if(!pool)return;
  if(!dbReadyPromise)dbReadyPromise=(async()=>{
    await pool.query(`CREATE TABLE IF NOT EXISTS chefe_telles_state (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS chefe_telles_backups (id BIGSERIAL PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const r=await pool.query('SELECT id FROM chefe_telles_state WHERE id=1');
    if(!r.rowCount)await pool.query(
      'INSERT INTO chefe_telles_state(id,data) VALUES(1,$1::jsonb)',
      [JSON.stringify(seed)]
    );
  })();
  return dbReadyPromise;
}
function normalizeData(d){
  let changed=false;
  if(!Array.isArray(d.categories)){d.categories=['Hambúrgueres','Pizzas','Combos','Bebidas','Açaí na Garrafa'];changed=true;}
  if(!d.categories.includes('Açaí na Garrafa')){d.categories.push('Açaí na Garrafa');changed=true;}
  if(!Array.isArray(d.deliveryZones)){d.deliveryZones=[];changed=true;}
  if(!Array.isArray(d.deliveryKmRanges)){d.deliveryKmRanges=[];changed=true;}
  if(!Array.isArray(d.drivers)){d.drivers=[];changed=true;}
  if(d.settings.deliveryMode!=='route'){d.settings.deliveryMode='route';changed=true;}
  if(d.settings.extraKmFee===undefined){d.settings.extraKmFee=0;changed=true;}
  if(d.settings.maxDeliveryKm===undefined){d.settings.maxDeliveryKm=0;changed=true;}
  if(d.settings.storeLat===undefined)d.settings.storeLat='';
  if(d.settings.storeLng===undefined)d.settings.storeLng='';
  if(!Array.isArray(d.orders)){d.orders=[];changed=true;}
  if(!Array.isArray(d.products))d.products=[];
  if(!d.products.some(p=>p.cat==='Açaí na Garrafa')){d.products.push({id:Date.now()+17,name:'Açaí na Garrafa 300ml',cat:'Açaí na Garrafa',price:12,emoji:'',desc:'Açaí cremoso servido na garrafa.',image:'',active:true});changed=true;}
  return {d,changed};
}
async function read(){
  try{
    if(pool){
      await ensureDb();
      const r=await pool.query('SELECT data FROM chefe_telles_state WHERE id=1');
      const n=normalizeData(r.rows[0]?.data || JSON.parse(JSON.stringify(seed)));
      if(n.changed)await write(n.d);
      return n.d;
    }
    if(!fs.existsSync(DB))fs.writeFileSync(DB,JSON.stringify(seed,null,2));
    const n=normalizeData(JSON.parse(fs.readFileSync(DB,'utf8')));
    if(n.changed)fs.writeFileSync(DB,JSON.stringify(n.d,null,2));
    return n.d;
  }catch(e){
    console.error('Falha ao ler dados:',e.message);
    return JSON.parse(JSON.stringify(seed));
  }
}
async function write(d){
  if(pool){
    await ensureDb();
    await pool.query('INSERT INTO chefe_telles_backups(data) VALUES($1::jsonb)',[JSON.stringify(d)]);
    await pool.query('DELETE FROM chefe_telles_backups WHERE id NOT IN (SELECT id FROM chefe_telles_backups ORDER BY id DESC LIMIT 200)');
    await pool.query(
      `INSERT INTO chefe_telles_state(id,data,updated_at) VALUES(1,$1::jsonb,NOW())
       ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`,
      [JSON.stringify(d)]
    );
    return;
  }
  fs.writeFileSync(DB,JSON.stringify(d,null,2));
}
function send(res,status,data,type='application/json'){
  res.writeHead(status, {'Content-Type':type,'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>10*1024*1024){reject(new Error('Payload muito grande'));req.destroy();}});req.on('end',()=>{try{resolve(b?JSON.parse(b):{});}catch(e){reject(e);}});});}
function localDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());}
function contentType(file){const e=path.extname(file).toLowerCase();return ({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'})[e]||'application/octet-stream';}
function printJson(entries){return JSON.stringify(Object.fromEntries(entries.map((v,i)=>[i,v])));}
function addText(entries,content,bold=0,align=0,format=0){entries.push({type:0,content:String(content??''),bold,align,format});}

const adminTokens = new Set();
function auth(req){ const h=req.headers.authorization||''; return h.startsWith('Bearer ') && adminTokens.has(h.slice(7)); }
function normalizeDeliveryText(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function resolveDeliveryFee(zones, neighborhood, street){
  const nb=normalizeDeliveryText(neighborhood), st=normalizeDeliveryText(street);
  if(!nb)return null;
  const same=(zones||[]).filter(z=>z.active!==false&&normalizeDeliveryText(z.neighborhood)===nb);
  if(!same.length)return null;
  const exact=same.find(z=>st&&normalizeDeliveryText(z.street)===st);
  if(exact)return Number(exact.fee)||0;
  const bairro=same.find(z=>!normalizeDeliveryText(z.street));
  return bairro ? Number(bairro.fee)||0 : null;
}


function haversineKm(a,b,c,d){const R=6371,toRad=x=>Number(x)*Math.PI/180;const dLat=toRad(c-a),dLon=toRad(d-b);const q=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(q));}
function resolveKmFee(ranges,km,settings={}){
  const active=(ranges||[]).filter(x=>x.active!==false&&Number(x.maxKm)>0)
    .sort((a,b)=>Number(a.maxKm)-Number(b.maxKm));
  if(!active.length)return null;
  const d=Number(km);
  const maxDeliveryKm=Number(settings.maxDeliveryKm||0);
  if(maxDeliveryKm>0&&d>maxDeliveryKm)return null;

  // Cada faixa representa um ponto da tabela. Entre dois pontos, o preço cresce
  // proporcionalmente por km. Ex.: 2km=R$5, 4km=R$10 -> 4,2km continua crescendo.
  if(d<=Number(active[0].maxKm)){
    // A primeira faixa é a TAXA MÍNIMA.
    // Ex.: 2 km = R$5 => qualquer rota até 2 km custa R$5.
    return Math.round(Number(active[0].fee||0)*100)/100;
  }
  for(let i=1;i<active.length;i++){
    const prev=active[i-1], cur=active[i];
    const aKm=Number(prev.maxKm), bKm=Number(cur.maxKm);
    if(d<=bKm){
      const aFee=Number(prev.fee||0), bFee=Number(cur.fee||0);
      const rate=(bFee-aFee)/(bKm-aKm);
      return Math.round((aFee+(d-aKm)*rate)*100)/100;
    }
  }
  const last=active[active.length-1];
  const extra=Number(settings.extraKmFee||0);
  return Math.round((Number(last.fee||0)+(d-Number(last.maxKm))*extra)*100)/100;
}

// Distância real pelas ruas. Por padrão usa OSRM; em produção pode apontar ROUTING_BASE_URL para sua própria instância/provedor compatível.
async function roadRouteKm(storeLat,storeLng,customerLat,customerLng){
  const vals=[storeLat,storeLng,customerLat,customerLng].map(Number);
  if(vals.some(v=>!Number.isFinite(v)))throw new Error('Coordenadas inválidas');
  const [a,b,c,d]=vals;
  const base=String(process.env.ROUTING_BASE_URL||'https://router.project-osrm.org').replace(/\/$/,'');
  const url=`${base}/route/v1/driving/${b},${a};${d},${c}?overview=false&steps=false`;
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),8000);
  try{
    const r=await fetch(url,{headers:{'User-Agent':'CHEFE-TELLES/1.0'},signal:ctrl.signal});
    if(!r.ok)throw new Error('Roteador indisponível');
    const j=await r.json(); const meters=Number(j?.routes?.[0]?.distance);
    if(!Number.isFinite(meters)||meters<100)throw new Error('Rota inválida. Confirme o ponto correto da entrega no mapa.');
    return {km:meters/1000,source:'road'};
  } finally { clearTimeout(timer); }
}

async function lookupCep(cep){
  const c=String(cep||'').replace(/\D/g,''); if(c.length!==8) throw Error('CEP inválido.');
  const r=await fetch(`https://viacep.com.br/ws/${c}/json/`,{headers:{'User-Agent':'CHEFE-TELLES/9.2'}}); if(!r.ok) throw Error('Não foi possível consultar o CEP.');
  const j=await r.json(); if(j.erro) throw Error('CEP não encontrado.');
  return {cep:j.cep||c,street:j.logradouro||'',neighborhood:j.bairro||'',city:j.localidade||'',state:j.uf||''};
}
async function geocodeBrazilAddress(x){
  const cep=String(x.cep||'').replace(/\D/g,'');
  let cepData={cep:'',street:'',neighborhood:'',city:'',state:''};
  if(cep.length===8){
    try{cepData=await lookupCep(cep)}catch{}
  }
  const street=String(x.street||cepData.street||'').trim();
  const number=String(x.number||'').trim();
  const neighborhood=String(x.neighborhood||cepData.neighborhood||'').trim();
  const city=String(x.city||cepData.city||'').trim();
  const state=String(x.state||cepData.state||'').trim();

  // 1) tenta coordenadas do próprio CEP (BrasilAPI/OpenStreetMap), quando disponíveis.
  // Isso evita aceitar um endereço homônimo em outro bairro/cidade.
  let cepPoint=null;
  if(cep.length===8){
    try{
      const br=await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`,{headers:{'User-Agent':'CHEFE-TELLES/10.0'}});
      if(br.ok){
        const bj=await br.json(), c=bj?.location?.coordinates||{};
        const lat=Number(c.latitude),lng=Number(c.longitude);
        if(Number.isFinite(lat)&&Number.isFinite(lng)&&lat&&lng)cepPoint={lat,lng};
      }
    }catch{}
  }

  const headers={'User-Agent':'CHEFE-TELLES/10.0 (delivery geocoder)','Accept-Language':'pt-BR'};
  const queries=[
    [street,number,neighborhood,city,state,cep,'Brasil'],
    [street,number,city,state,cep,'Brasil'],
    [street,neighborhood,city,state,cep,'Brasil'],
    [street,city,state,cep,'Brasil']
  ].map(v=>v.filter(Boolean).join(', ')).filter((v,i,a)=>v&&a.indexOf(v)===i);

  let candidates=[];
  for(const q of queries){
    try{
      const url='https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=br&q='+encodeURIComponent(q);
      const r=await fetch(url,{headers}); if(!r.ok)continue;
      const arr=await r.json(); candidates.push(...arr);
      if(candidates.length>=8)break;
    }catch{}
  }
  if(!candidates.length){
    throw Error('Não foi possível localizar rua e número com segurança. Use a busca ou confirme o ponto no mapa.');
  }

  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const hav=(a,b,c,d)=>{const R=6371,toRad=v=>v*Math.PI/180,dl=toRad(c-a),dn=toRad(d-b);const z=Math.sin(dl/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(z));};
  const scored=candidates.map(c=>{
    const a=c.address||{}; let score=0;
    const cCity=a.city||a.town||a.municipality||a.village||'';
    const cNb=a.suburb||a.neighbourhood||a.quarter||a.city_district||'';
    const cRoad=a.road||a.pedestrian||a.residential||'';
    const cPost=String(a.postcode||'').replace(/\D/g,'');
    if(city&&norm(cCity)===norm(city))score+=35;
    if(neighborhood&&norm(cNb)===norm(neighborhood))score+=25;
    if(street&&norm(cRoad)===norm(street))score+=30;
    if(cep&&cPost===cep)score+=45;
    const lat=Number(c.lat),lng=Number(c.lon);
    if(cepPoint&&Number.isFinite(lat)&&Number.isFinite(lng)){
      const km=hav(cepPoint.lat,cepPoint.lng,lat,lng);
      if(km<1)score+=35; else if(km<3)score+=20; else if(km>10)score-=60;
    }
    return {c,score};
  }).sort((a,b)=>b.score-a.score);
  const best=scored[0]?.c;
  if(!best)throw Error('Não encontramos esse endereço.');
  const ba=best.address||{};
  const bestCity=ba.city||ba.town||ba.municipality||ba.village||'';
  const bestRoad=ba.road||ba.pedestrian||ba.residential||'';
  const bestPost=String(ba.postcode||'').replace(/\D/g,'');
  if(city && bestCity && norm(bestCity)!==norm(city))throw Error('O endereço encontrado pertence a outra cidade. Confira os dados ou confirme no mapa.');
  if(street && bestRoad && norm(bestRoad)!==norm(street) && !norm(best.display_name).includes(norm(street)))
    throw Error('Não foi possível confirmar essa rua com segurança. Selecione o endereço na busca ou confirme o ponto no mapa.');
  if(cep && bestPost && bestPost!==cep)
    throw Error('O CEP não confere com o ponto encontrado. Confira o endereço ou confirme no mapa.');
  return {lat:Number(best.lat),lng:Number(best.lon),displayName:best.display_name,precision:number?'address':'street'};
}

async function reverseGeocodeBrazil(lat,lng){
  lat=Number(lat); lng=Number(lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)) throw Error('Coordenadas inválidas.');
  const url='https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lng);
  const r=await fetch(url,{headers:{'User-Agent':'CHEFE-TELLES/9.5 (store reverse geocoder)','Accept-Language':'pt-BR'}});
  if(!r.ok) throw Error('Não foi possível consultar o endereço desta localização.');
  const j=await r.json(); const a=j.address||{};
  return {
    lat, lng,
    cep:a.postcode||'',
    street:a.road||a.pedestrian||a.residential||a.footway||'',
    number:a.house_number||'',
    neighborhood:a.suburb||a.neighbourhood||a.quarter||a.city_district||'',
    city:a.city||a.town||a.municipality||a.village||'',
    state:a.state_code||a['ISO3166-2-lvl4']?.split('-').pop()||a.state||'',
    addressFound:j.display_name||''
  };
}

async function deliveryKm(settings,lat,lng){
  if(!settings.storeLat||!settings.storeLng)throw Error('A localização da loja ainda não foi confirmada no painel do dono.');
  // Para cobrança não usamos linha reta/aproximação. Se o roteador falhar,
  // a taxa não é liberada até obter a rota real pelas ruas.
  return await roadRouteKm(settings.storeLat,settings.storeLng,lat,lng);
}


async function printEndpoint(req,res,pathname){
  if(req.method!=='GET') return false;
  if(pathname==='/print/test'){
    const e=[]; addText(e,'CHEFE TELLES',1,1,2); addText(e,'TESTE DE IMPRESSÃO',1,1,1); addText(e,'--------------------------------'); addText(e,'Android / Thermer OK'); addText(e,'iPhone / bprint OK'); addText(e,'PC / QZ Tray OK'); addText(e,' '); addText(e,' ');
    return send(res,200,JSON.parse(printJson(e)));
  }
  const m=pathname.match(/^\/print\/(\d+)$/); if(!m)return false;
  const d=await read(),o=d.orders.find(x=>String(x.id)===m[1]); if(!o)return send(res,404,{error:'Pedido não encontrado'});
  const e=[]; addText(e,'CHEFE TELLES',1,1,2); addText(e,'PEDIDO '+String(o.number).padStart(2,'0'),1,1,1); addText(e,new Date(o.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),0,1,0); addText(e,'--------------------------------');
  addText(e,'STATUS: '+(o.status||'Novo')); addText(e,'CLIENTE: '+(o.customer?.name||'')); if(o.customer?.phone)addText(e,'WHATSAPP: '+o.customer.phone); if(o.customer?.reference)addText(e,'PONTO DE REFERÊNCIA: '+o.customer.reference); addText(e,'--------------------------------');
  for(const i of (o.items||[])) addText(e,`${i.qty}x ${i.name} - R$ ${(Number(i.price||0)*Number(i.qty||0)).toFixed(2)}`);
  addText(e,'--------------------------------'); addText(e,'SUBTOTAL: R$ '+Number(o.subtotal||o.total||0).toFixed(2)); addText(e,'ENTREGA: R$ '+Number(o.deliveryFee||0).toFixed(2)); addText(e,'TOTAL: R$ '+Number(o.total||0).toFixed(2),1,0,1); addText(e,'PAGAMENTO: '+(o.customer?.payment||'')); addText(e,o.customer?.delivery==='Retirada'?'TIPO: RETIRADA NA LOJA':'ENDEREÇO: '+(o.customer?.address||'')); if(o.deliveryDistanceKm)addText(e,'DISTÂNCIA: '+o.deliveryDistanceKm+' km'); addText(e,'OBS: '+(o.customer?.note||'Nenhuma')); addText(e,' '); addText(e,' ');
  return send(res,200,JSON.parse(printJson(e)));
}


function printAgentAuthorized(req){
  const configured=String(process.env.PRINT_AGENT_KEY||'').trim();
  if(!configured)return false;
  return String(req.headers['x-print-agent-key']||'')===configured;
}

async function api(req,res,pathname){
  try{

    // CHEFE TELLES Print Android: leitura segura de pedidos para impressão.
    if(req.method==='GET'&&pathname==='/api/print-agent/orders'){
      if(!printAgentAuthorized(req))return send(res,401,{error:'Agente de impressão não autorizado'});
      const d=await read();
      return send(res,200,d.orders.slice().reverse());
    }

    if(req.method==='GET'&&pathname==='/api/health')return send(res,200,{ok:true,store:'CHEFE TELLES',version:'2.0.0'});
    if(req.method==='GET'&&pathname==='/api/network'){
      const nets=os.networkInterfaces(), ips=[];
      for(const list of Object.values(nets)) for(const n of (list||[])) if(n.family==='IPv4'&&!n.internal) ips.push(n.address);
      return send(res,200,{ips:[...new Set(ips)]});
    }
    if(req.method==='GET'&&pathname==='/api/store'){
      const d=await read();
      return send(res,200,{settings:{name:d.settings.name,whatsapp:d.settings.whatsapp,pixKey:d.settings.pixKey||'',pixRecipient:d.settings.pixRecipient||'',pixType:d.settings.pixType||'',pixQr:d.settings.pixQr||'',botWhatsapp:d.settings.botWhatsapp||d.settings.whatsapp,botMessage:d.settings.botMessage||'',deliveryMode:'route',storeLat:d.settings.storeLat||'',storeLng:d.settings.storeLng||'',extraKmFee:Number(d.settings.extraKmFee)||0,maxDeliveryKm:Number(d.settings.maxDeliveryKm)||0},categories:d.categories,products:d.products.filter(p=>p.active),deliveryZones:d.deliveryZones.filter(z=>z.active!==false),deliveryKmRanges:(d.deliveryKmRanges||[]).filter(z=>z.active!==false)});
    }
    if(req.method==='POST'&&pathname==='/api/login'){
      const b=await body(req),d=await read();
      if(String(b.password||'')!==String(d.settings.adminPassword)) return send(res,401,{ok:false,error:'Senha incorreta'});
      const token=crypto.randomBytes(24).toString('hex'); adminTokens.add(token); return send(res,200,{ok:true,token});
    }
    if(req.method==='POST'&&pathname==='/api/logout'){const h=req.headers.authorization||''; if(h.startsWith('Bearer '))adminTokens.delete(h.slice(7)); return send(res,200,{ok:true});}

    if(req.method==='GET'&&pathname==='/api/address-search'){
      const searchUrl=new URL(req.url,'http://localhost');
      const q=String(searchUrl.searchParams.get('q')||'').trim();
      const neighborhood=String(searchUrl.searchParams.get('neighborhood')||'').trim();
      if(q.length<2 && neighborhood.length<2)return send(res,200,[]);
      try{
        const d=await read();
        const city=String(d.settings.storeCity||'').trim();
        const state=String(d.settings.storeState||'').trim();
        const headers={'User-Agent':'CHEFE-TELLES/10.3 (address autocomplete)','Accept-Language':'pt-BR'};
        const urls=[];
        // Busca estruturada primeiro: rua + bairro + cidade/UF.
        if(q){
          const params=new URLSearchParams({format:'jsonv2',addressdetails:'1',limit:'15',countrycodes:'br',street:q});
          if(city)params.set('city',city);
          if(state)params.set('state',state);
          urls.push('https://nominatim.openstreetmap.org/search?'+params.toString());
        }
        // Fallback textual é importante para "Corredor", travessas e nomes locais.
        const full=[q,neighborhood,city,state,'Brasil'].filter(Boolean).join(', ');
        if(full)urls.push('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=15&countrycodes=br&q='+encodeURIComponent(full));
        if(neighborhood){
          const byBairro=[q||'rua',neighborhood,city,state,'Brasil'].filter(Boolean).join(', ');
          urls.push('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=15&countrycodes=br&q='+encodeURIComponent(byBairro));
        }
        let all=[];
        // Primeiro usa a busca normal de endereço, que é mais rápida para autocomplete.
        for(const url of urls){
          try{
            const r=await fetch(url,{headers,signal:AbortSignal.timeout(3500)});
            if(r.ok)all.push(...await r.json());
          }catch{}
          if(all.length>=10)break;
        }

        // Se a busca normal não achar o suficiente, procura nomes de ruas mapeadas
        // perto da loja. O timeout impede travamento do checkout.
        const storeLat=Number(d.settings.storeLat), storeLng=Number(d.settings.storeLng);
        if(all.length<5 && q.length>=3 && Number.isFinite(storeLat) && Number.isFinite(storeLng)){
          try{
            const words=normalizeSearchText(q).split(' ').filter(Boolean);
            const oq=`[out:json][timeout:3];way(around:12000,${storeLat},${storeLng})["highway"]["name"];out tags center 500;`;
            const or=await fetch('https://overpass-api.de/api/interpreter',{
              method:'POST',
              headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'CHEFE-TELLES/10.18'},
              body:'data='+encodeURIComponent(oq),
              signal:AbortSignal.timeout(3500)
            });
            if(or.ok){
              const od=await or.json(),localSeen=new Set();
              for(const x of (od.elements||[])){
                const name=String(x.tags?.name||'').trim(),norm=normalizeSearchText(name),lat=Number(x.center?.lat),lon=Number(x.center?.lon);
                if(name&&words.every(w=>norm.includes(w))&&Number.isFinite(lat)&&Number.isFinite(lon)&&!localSeen.has(norm)){
                  localSeen.add(norm);
                  all.push({lat:String(lat),lon:String(lon),display_name:[name,city,state,'Brasil'].filter(Boolean).join(', '),address:{road:name,city,state}});
                  if(all.length>=15)break;
                }
              }
            }
          }catch{}
        }
        const seen=new Set();
        const out=all.filter(x=>{
          const key=Number(x.lat).toFixed(6)+','+Number(x.lon).toFixed(6);
          if(seen.has(key))return false; seen.add(key); return true;
        }).slice(0,15).map(x=>({lat:Number(x.lat),lng:Number(x.lon),label:x.display_name,address:x.address||{}}));
        return send(res,200,out);
      }catch(e){return send(res,400,{error:e.message||'Não foi possível buscar endereços.'});}
    }
    if(req.method==='GET'&&pathname==='/api/nearby-roads'){
      const lat=Number(u.searchParams.get('lat')),lng=Number(u.searchParams.get('lng'));
      if(!Number.isFinite(lat)||!Number.isFinite(lng))return send(res,400,{error:'Localização inválida.'});
      try{
        const query=`[out:json][timeout:12];way(around:2500,${lat},${lng})["highway"]["name"];out tags center;`;
        const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'CHEFE-TELLES/10.8'},body:'data='+encodeURIComponent(query)});
        if(!r.ok)throw Error('Serviço de ruas indisponível.');
        const data=await r.json(),seen=new Set(),roads=[];
        for(const x of (data.elements||[])){
          const name=String(x.tags?.name||'').trim(); if(!name)continue;
          const key=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
          if(seen.has(key))continue;seen.add(key);
          roads.push({name,lat:Number(x.center?.lat||lat),lng:Number(x.center?.lon||lng)});
        }
        roads.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
        return send(res,200,roads.slice(0,80));
      }catch(e){return send(res,400,{error:e.message||'Não foi possível listar as ruas próximas.'});}
    }

    if(req.method==='POST'&&pathname==='/api/customer-location/reverse'){
      const b=await body(req);
      try{return send(res,200,await reverseGeocodeBrazil(b.lat,b.lng));}
      catch(e){return send(res,400,{error:e.message||'Não foi possível identificar o endereço desse ponto.'});}
    }

    const cepMatch=pathname.match(/^\/api\/cep\/(\d{8})$/);
    if(req.method==='GET'&&cepMatch){try{return send(res,200,await lookupCep(cepMatch[1]));}catch(e){return send(res,404,{error:e.message});}}
    if(req.method==='POST'&&pathname==='/api/delivery-quote-address'){
      const b=await body(req),d=await read();
      if(!String(b.street||'').trim()||!String(b.number||'').trim())return send(res,400,{error:'Informe rua e número para calcular a entrega.'});
      try{const geo=await geocodeBrazilAddress(b);const route=await deliveryKm(d.settings,geo.lat,geo.lng),fee=resolveKmFee(d.deliveryKmRanges,route.km,d.settings);if(fee===null)return send(res,400,{error:'Endereço fora da distância máxima de entrega.',distanceKm:Number(route.km.toFixed(2))});return send(res,200,{lat:geo.lat,lng:geo.lng,addressFound:geo.displayName,distanceKm:Number(route.km.toFixed(2)),deliveryFee:fee,routeType:route.source});}catch(e){return send(res,400,{error:e.message||'Não foi possível calcular a entrega pelo endereço.'});}
    }
    if(req.method==='POST'&&pathname==='/api/delivery-quote'){
      const b=await body(req),d=await read();
      if(!d.settings.storeLat||!d.settings.storeLng||!b.lat||!b.lng)return send(res,400,{error:'Localização da loja ou cliente não informada.'});
      const route=await deliveryKm(d.settings,b.lat,b.lng), fee=resolveKmFee(d.deliveryKmRanges,route.km,d.settings);
      if(fee===null)return send(res,400,{error:'Localização fora da distância máxima de entrega.',distanceKm:Number(route.km.toFixed(2))});
      return send(res,200,{distanceKm:Number(route.km.toFixed(2)),deliveryFee:fee,routeType:route.source});
    }

    if(req.method==='POST'&&pathname==='/api/orders'){
      const b=await body(req),d=await read(),today=localDay();
      const count=d.orders.filter(o=>o.day===today).length+1;
      const subtotal=Number(b.subtotal ?? b.total ?? 0);
      let deliveryFee=0;
      if(b.customer?.delivery==='Retirada'){
        deliveryFee=0;
      }else{
        if(!d.settings.storeLat||!d.settings.storeLng)return send(res,400,{error:'A localização da loja ainda não foi confirmada no painel do dono.'});
        let lat=Number(b.customer?.lat),lng=Number(b.customer?.lng);
        if(!Number.isFinite(lat)||!Number.isFinite(lng)||!lat||!lng){
          try{const geo=await geocodeBrazilAddress(b.customer||{});lat=geo.lat;lng=geo.lng;b.customer.lat=lat;b.customer.lng=lng;}catch(e){return send(res,400,{error:e.message||'Não foi possível localizar o endereço para calcular a entrega.'});}
        }
        const route=await deliveryKm(d.settings,lat,lng), resolved=resolveKmFee(d.deliveryKmRanges,route.km,d.settings);
        if(resolved===null)return send(res,400,{error:'Endereço fora da distância máxima de entrega.',distanceKm:Number(route.km.toFixed(2))});
        deliveryFee=Number(resolved.toFixed(2)); b.deliveryDistanceKm=Number(route.km.toFixed(2)); b.deliveryRouteType=route.source;
      }
      const customer={...(b.customer||{})};
      if(customer.delivery!=='Retirada'){
        const street=String(customer.street||'').trim(), number=String(customer.number||'').trim(), complement=String(customer.complement||'').trim(), neighborhood=String(customer.neighborhood||'').trim(), reference=String(customer.reference||'').trim();
        customer.address=[street,number&&('Nº '+number),neighborhood,complement,reference&&('Referência: '+reference)].filter(Boolean).join(', ');
      }else customer.address='Retirada na loja';
      const createdAt=new Date().toISOString();
      const createdAtText=new Date(createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const order={...b,customer,id:Date.now(),day:today,number:count,status:'Novo',statusHistory:[{status:'Novo',at:createdAt}],driverId:null,estimatedMinutes:Number(d.settings.defaultEtaMinutes||0),createdAt,createdAtText,subtotal,deliveryFee,total:subtotal+deliveryFee};
      d.orders.push(order);await write(d);return send(res,201,order);
    }

    if(!auth(req)) return send(res,401,{error:'Não autorizado'});

    if(req.method==='POST'&&pathname==='/api/store-location/reverse'){
      const b=await body(req);
      try{return send(res,200,await reverseGeocodeBrazil(b.lat,b.lng));}
      catch(e){return send(res,400,{error:e.message||'Não foi possível preencher o endereço pelo GPS.'});}
    }

    if(req.method==='POST'&&pathname==='/api/store-location/resolve'){
      const b=await body(req);
      try{const geo=await geocodeBrazilAddress(b);return send(res,200,{lat:geo.lat,lng:geo.lng,addressFound:geo.displayName});}
      catch(e){return send(res,400,{error:e.message||'Não foi possível localizar o endereço da loja.'});}
    }

    if(req.method==='GET'&&pathname==='/api/admin'){ const d=await read(); return send(res,200,d); }
    if(req.method==='PUT'&&pathname==='/api/settings'){
      const b=await body(req),d=await read();if(b.adminPassword!==undefined&&String(b.adminPassword).trim()==='') delete b.adminPassword; d.settings={...d.settings,...b}; await write(d); return send(res,200,{ok:true});
    }
    if(req.method==='GET'&&pathname==='/api/orders')return send(res,200,(await read()).orders.slice().reverse());
    const om=pathname.match(/^\/api\/orders\/(\d+)$/);
    if(om&&req.method==='PUT'){const b=await body(req),d=await read(),o=d.orders.find(x=>String(x.id)===om[1]);if(!o)return send(res,404,{error:'Pedido não encontrado'});if(b.status&&b.status!==o.status){o.status=b.status;o.statusHistory=Array.isArray(o.statusHistory)?o.statusHistory:[];o.statusHistory.push({status:b.status,at:new Date().toISOString()});} if(b.driverId!==undefined)o.driverId=b.driverId||null;if(b.estimatedMinutes!==undefined)o.estimatedMinutes=Number(b.estimatedMinutes)||0;await write(d);return send(res,200,o);}
    if(om&&req.method==='DELETE'){
      const d=await read(),i=d.orders.findIndex(x=>String(x.id)===om[1]);
      if(i<0)return send(res,404,{error:'Pedido não encontrado'});
      const removed=d.orders.splice(i,1)[0];
      await write(d);
      return send(res,200,{ok:true,id:removed.id});
    }

    if(req.method==='GET'&&pathname==='/api/categories') return send(res,200,(await read()).categories||[]);
    if(req.method==='POST'&&pathname==='/api/categories'){
      const b=await body(req),d=await read(); const name=String(b.name||'').trim();
      if(!name)return send(res,400,{error:'Informe o nome da categoria'});
      if((d.categories||[]).some(c=>normalizeDeliveryText(c)===normalizeDeliveryText(name)))return send(res,409,{error:'Categoria já existe'});
      d.categories.push(name); await write(d); return send(res,201,{name});
    }
    const cm=pathname.match(/^\/api\/categories\/(\d+)$/);
    if(cm&&req.method==='PUT'){
      const b=await body(req),d=await read(),idx=Number(cm[1]),old=d.categories[idx],name=String(b.name||'').trim();
      if(old===undefined)return send(res,404,{error:'Categoria não encontrada'});
      if(!name)return send(res,400,{error:'Informe o nome da categoria'});
      if(d.categories.some((c,i)=>i!==idx&&normalizeDeliveryText(c)===normalizeDeliveryText(name)))return send(res,409,{error:'Categoria já existe'});
      d.categories[idx]=name; d.products.forEach(p=>{if(normalizeDeliveryText(p.cat)===normalizeDeliveryText(old))p.cat=name}); await write(d); return send(res,200,{name});
    }
    if(cm&&req.method==='DELETE'){
      const d=await read(),idx=Number(cm[1]),name=d.categories[idx];
      if(name===undefined)return send(res,404,{error:'Categoria não encontrada'});
      const used=d.products.some(p=>normalizeDeliveryText(p.cat)===normalizeDeliveryText(name)&&p.active!==false);
      if(used)return send(res,409,{error:'Não é possível excluir: existem produtos ativos nesta categoria. Edite ou mova os produtos primeiro.'});
      d.categories.splice(idx,1); await write(d); return send(res,200,{ok:true});
    }

    if(req.method==='POST'&&pathname==='/api/products'){
      const b=await body(req),d=await read();const p={id:Date.now(),active:true,emoji:'🍔',image:'',desc:'',...b,price:Number(b.price)||0};d.products.push(p);await write(d);return send(res,201,p);
    }
    const pm=pathname.match(/^\/api\/products\/(\d+)$/);
    if(pm&&req.method==='PUT'){const b=await body(req),d=await read(),i=d.products.findIndex(x=>String(x.id)===pm[1]);if(i<0)return send(res,404,{error:'Produto não encontrado'});d.products[i]={...d.products[i],...b,price:Number(b.price)||0};await write(d);return send(res,200,d.products[i]);}
    if(pm&&req.method==='DELETE'){const d=await read(),p=d.products.find(x=>x.id==pm[1]);if(p)p.active=false;await write(d);return send(res,200,{ok:true});}

    if(req.method==='POST'&&pathname==='/api/drivers'){const b=await body(req),d=await read();const x={id:Date.now(),name:String(b.name||'').trim(),phone:String(b.phone||'').trim(),active:b.active!==false};if(!x.name)return send(res,400,{error:'Informe o nome do entregador'});d.drivers.push(x);await write(d);return send(res,201,x);}
    const dm=pathname.match(/^\/api\/drivers\/(\d+)$/);if(dm&&req.method==='DELETE'){const d=await read();d.drivers=d.drivers.filter(x=>String(x.id)!==dm[1]);await write(d);return send(res,200,{ok:true});}
    if(req.method==='POST'&&pathname==='/api/delivery-km'){const b=await body(req),d=await read();const x={id:Date.now(),maxKm:Number(b.maxKm)||0,fee:Number(b.fee)||0,active:true};if(x.maxKm<=0)return send(res,400,{error:'Informe a distância'});d.deliveryKmRanges.push(x);await write(d);return send(res,201,x);}
    const km=pathname.match(/^\/api\/delivery-km\/(\d+)$/);if(km&&req.method==='DELETE'){const d=await read();d.deliveryKmRanges=d.deliveryKmRanges.filter(x=>String(x.id)!==km[1]);await write(d);return send(res,200,{ok:true});}

    if(req.method==='POST'&&pathname==='/api/delivery-zones'){
      const b=await body(req),d=await read();const z={id:Date.now(),neighborhood:String(b.neighborhood||'').trim(),street:String(b.street||'').trim(),fee:Number(b.fee)||0,active:b.active!==false};
      if(!z.neighborhood)return send(res,400,{error:'Informe o bairro'});
      d.deliveryZones.push(z);await write(d);return send(res,201,z);
    }
    const zm=pathname.match(/^\/api\/delivery-zones\/(\d+)$/);
    if(zm&&req.method==='PUT'){const b=await body(req),d=await read(),i=d.deliveryZones.findIndex(x=>String(x.id)===zm[1]);if(i<0)return send(res,404,{error:'Taxa não encontrada'});d.deliveryZones[i]={...d.deliveryZones[i],...b,fee:Number(b.fee)||0};await write(d);return send(res,200,d.deliveryZones[i]);}
    if(zm&&req.method==='DELETE'){const d=await read();d.deliveryZones=d.deliveryZones.filter(x=>String(x.id)!==zm[1]);await write(d);return send(res,200,{ok:true});}

    return send(res,404,{error:'API não encontrada'});
  }catch(e){console.error(e);return send(res,500,{error:'Erro no servidor',detail:e.message});}
}

const server=http.createServer(async(req,res)=>{
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if(await printEndpoint(req,res,pathname))return;
  if(pathname.startsWith('/api/'))return api(req,res,pathname);
  if(pathname==='/admin'||pathname==='/admin/'){
    const f=path.join(ROOT,'admin','index.html');
    if(!fs.existsSync(f)) return send(res,500,{error:'Painel do dono não encontrado'});
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return fs.createReadStream(f).pipe(res);
  }
  let filePath=path.join(ROOT,pathname==='/'?'index.html':pathname); if(!filePath.startsWith(ROOT))return send(res,403,'Forbidden','text/plain');
  fs.stat(filePath,(err,st)=>{if(err||!st.isFile())return send(res,404,'Arquivo não encontrado','text/plain; charset=utf-8');res.writeHead(200,{'Content-Type':contentType(filePath),'Cache-Control':'no-cache'});fs.createReadStream(filePath).pipe(res);});
});
function listenOnAvailablePort(server, port) {
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && port < DEFAULT_PORT + 10) {
      PORT = port + 1;
      console.log(`Porta ${port} ocupada. Tentando porta ${PORT}...`);
      setTimeout(() => listenOnAvailablePort(server, PORT), 100);
      return;
    }
    console.error('Não foi possível iniciar o servidor:', err.message);
    process.exitCode = 1;
  });
  server.listen(port,'0.0.0.0',()=>console.log(`\nCHEFE TELLES v2.0 — servidor online\nLoja:   http://localhost:${port}/\nDono:   http://localhost:${port}/admin\nThermer: http://localhost:${port}/thermer-test.html\n`));
}
listenOnAvailablePort(server, PORT);
