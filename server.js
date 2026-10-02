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

// V10.52 — diretório interno Jequié: bairro -> rua -> CEP (CEP invisível no checkout)
const JEQUIE_BASE_FILE=path.join(ROOT,'jequie-address-base.json');
let jequieBase={city:'Jequié',state:'BA',neighborhoods:[],entries:[]};
try{jequieBase=JSON.parse(fs.readFileSync(JEQUIE_BASE_FILE,'utf8'));}catch{}
const directoryMemory=new Map();
function normAddress(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function htmlText(v){return String(v||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&ordf;/g,'ª').replace(/&ordm;/g,'º').replace(/&aacute;/g,'á').replace(/&eacute;/g,'é').replace(/&iacute;/g,'í').replace(/&oacute;/g,'ó').replace(/&uacute;/g,'ú').replace(/&ccedil;/g,'ç').replace(/&atilde;/g,'ã').replace(/&otilde;/g,'õ').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g,' ').trim();}
function neighborhoodSlug(v){const n=normAddress(v);const special={'km iii':'km-3','km iv':'km-4','km 3':'km-3','km 4':'km-4','caixa d agua':'caixa-dagua'};return special[n]||n.replace(/ /g,'-');}
function bestNeighborhoodName(nb){
  let n=normAddress(nb);if(!n)return '';
  const locality=jequieBase.localityAliases||{};
  const locKey=Object.keys(locality).find(k=>normAddress(k)===n);
  if(locKey)return locality[locKey];
  const alias=jequieBase.neighborhoodAliases?.[n];if(alias)return alias;
  const names=jequieBase.neighborhoods||[];
  const exact=names.find(x=>normAddress(x)===n);if(exact)return exact;
  const partial=names.find(x=>normAddress(x).includes(n)||n.includes(normAddress(x)));
  return partial||String(nb||'').trim();
}
function seedDirectoryFor(nb){
  const raw=String(nb||'').trim(),sources=jequieBase.localityNeighborhoods||{};
  const locKey=Object.keys(sources).find(k=>normAddress(k)===normAddress(raw));
  const names=locKey?sources[locKey]:[bestNeighborhoodName(raw)];
  const wanted=new Set(names.map(normAddress));
  return (jequieBase.entries||[]).filter(x=>wanted.has(normAddress(x.neighborhood)));
}
function publicNeighborhoods(){
  const out=[],seen=new Set();
  // Mostra bairros e também nomes locais conhecidos (residenciais/loteamentos/conjuntos).
  // O cálculo continua usando internamente o bairro postal canônico.
  const all=[...(jequieBase.neighborhoods||[]),...Object.keys(jequieBase.localityAliases||{})];
  for(const raw of all){
    const label=String(raw||'').trim(),k=normAddress(label);
    if(k&&!seen.has(k)){seen.add(k);out.push(label);}
  }
  return out.sort((a,b)=>a.localeCompare(b,'pt-BR'));
}

async function loadJequieNeighborhood(nb){
  const requested=String(nb||'').trim(); const key=normAddress(requested); if(!key)return [];
  const canonical=bestNeighborhoodName(requested);
  if(directoryMemory.has(key))return directoryMemory.get(key);
  let rows=seedDirectoryFor(requested);
  // Resposta de produção deve ser rápida no celular/PC. Se já existe base local,
  // ela é usada imediatamente; nunca fazemos o cliente esperar um site externo.
  if(rows.length){directoryMemory.set(key,rows);return rows;}
  // Para bairro ainda ausente, tentamos fontes públicas sem substituir a base.
  try{
    const slug=neighborhoodSlug(canonical),u=`https://codigo-postal.org/pt-br/brasil/ba/jequie/${slug}/`;
    const r=await fetch(u,{headers:{'User-Agent':'CHEFE-TELLES/10.58 address directory','Accept-Language':'pt-BR'},signal:AbortSignal.timeout(6500)});
    if(r.ok){const h=await r.text();const trs=h.match(/<tr[\s\S]*?<\/tr>/gi)||[];const parsed=[];
      for(const tr of trs){const td=[...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>htmlText(m[1]));if(td.length>=4&&/^\d{5}-?\d{3}$/.test(td[0]))parsed.push({cep:td[0],street:td[1],complement:td[2]||'',neighborhood:td[3]||canonical});}
      if(parsed.length)rows=rows.concat(parsed);
    }
  }catch{}
  // Segunda fonte pública de apoio. Serve para preencher bairros cuja primeira
  // fonte esteja indisponível ou incompleta; nunca substitui registros existentes.
  try{
    const slug=neighborhoodSlug(canonical),u=`https://www.cepsdobrasil.com.br/cep/ba/jequie/bairro/${slug}`;
    const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0 CHEFE-TELLES/10.58','Accept-Language':'pt-BR'},signal:AbortSignal.timeout(6500)});
    if(r.ok){
      const h=await r.text(),trs=h.match(/<tr[\s\S]*?<\/tr>/gi)||[],parsed=[];
      for(const tr of trs){
        const td=[...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>htmlText(m[1]));
        const cepCell=td.find(v=>/^\d{5}-?\d{3}$/.test(v));
        if(!cepCell)continue;
        const streetCell=td.find(v=>v&&v!==cepCell&&!/^Jequi[eé]\s*\/\s*BA$/i.test(v)&&normAddress(v)!==normAddress(nb));
        if(streetCell)parsed.push({cep:cepCell,street:streetCell,complement:'',neighborhood:nb});
      }
      if(parsed.length)rows=rows.concat(parsed);
    }
  }catch{}
  const uniq=[];const seen=new Set();for(const x of rows){const k=[normAddress(x.neighborhood),normAddress(x.street),String(x.cep).replace(/\D/g,''),normAddress(x.complement)].join('|');if(!seen.has(k)){seen.add(k);uniq.push(x)}}
  directoryMemory.set(key,uniq);return uniq;
}
function pickDirectoryRow(rows,street,number){
  const sn=normAddress(street),num=Number(String(number||'').match(/\d+/)?.[0]||0);
  let same=rows.filter(x=>normAddress(x.street)===sn);
  if(!same.length)same=rows.filter(x=>normAddress(x.street).includes(sn)||sn.includes(normAddress(x.street)));
  // Digitação direta: aceita pequenas diferenças de prefixo/acento/grafia e resolve
  // para o mesmo logradouro canônico usado quando o cliente escolhe na busca.
  if(!same.length){
    const ranked=rows.map(x=>({x,score:searchSimilarity(sn,normAddress(x.street))}))
      .filter(o=>o.score>=.68).sort((a,b)=>b.score-a.score);
    if(ranked.length) same=ranked.filter(o=>o.score>=ranked[0].score-.03).map(o=>o.x);
  }
  if(!same.length)return null;if(same.length===1)return same[0];
  const parity=same.find(x=>/lado par/i.test(x.complement||'')&&num%2===0)||same.find(x=>/lado (?:impar|ímpar)/i.test(x.complement||'')&&num%2===1);if(parity)return parity;
  for(const x of same){const m=String(x.complement||'').match(/at[eé]\s+(\d+)(?:\/(\d+))?/i);if(m&&num&&num<=Math.max(Number(m[1]),Number(m[2]||0)))return x;}
  return same[0];
}
async function enrichJequieAddress(x){
  const city=String(x.city||'Jequié').trim(),state=String(x.state||'BA').trim();if(normAddress(city)!=='jequie'||normAddress(state)!=='ba')return {...x};
  const rows=await loadJequieNeighborhood(x.neighborhood);const row=pickDirectoryRow(rows,x.street,x.number);if(!row)return {...x,city:'Jequié',state:'BA'};
  return {...x,street:row.street||x.street,neighborhood:row.neighborhood||x.neighborhood,cep:String(row.cep||'').replace(/\D/g,''),city:'Jequié',state:'BA',directoryMatch:true,directoryLat:Number.isFinite(Number(row.lat))?Number(row.lat):null,directoryLng:Number.isFinite(Number(row.lng))?Number(row.lng):null};
}


const seed = {
  categories: ['Hambúrgueres','Pizzas','Combos','Bebidas','Açaí na Garrafa'],
  settings: {
    name: 'Cheff Telles',
    whatsapp: '5573982451160',
    adminPassword: '1234',
    autoPrint: true,
    printerPort: 'COM11',
    printerBaud: 9600,
    deliveryMode: 'route',
    storeLat: '',
    storeLng: '',
    storeCep: '',
    storeStreet: '',
    storeNumber: '',
    storeNeighborhood: '',
    storeCity: 'Jequié',
    storeState: 'BA',
    defaultEtaMinutes: 0,
    extraKmFee: 0,
    maxDeliveryKm: 0,
    pixKey: '',
    pixRecipient: '',
    pixType: '',
    pixQr: '',
    botWhatsapp: '',
    botMessage: ''
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
  orders: [],
  customers: []
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
  if(!Array.isArray(d.addressCache)){d.addressCache=[];changed=true;}
  if(!Array.isArray(d.deliveryKmRanges)){d.deliveryKmRanges=[];changed=true;}
  if(d.deliveryKmRanges.length===0){d.deliveryKmRanges=[{id:1001,maxKm:1,fee:5,active:true},{id:1002,maxKm:2,fee:8,active:true},{id:1003,maxKm:4,fee:10,active:true},{id:1004,maxKm:6,fee:12,active:true},{id:1005,maxKm:8,fee:15,active:true},{id:1006,maxKm:9,fee:18,active:true}];changed=true;}
  if(d.settings.deliveryTableVersion===undefined){d.settings.deliveryTableVersion=1;changed=true;}
  if(!Array.isArray(d.drivers)){d.drivers=[];changed=true;}
  if(d.settings.deliveryMode!=='route'){d.settings.deliveryMode='route';changed=true;}
  if(d.settings.extraKmFee===undefined){d.settings.extraKmFee=0;changed=true;}
  if(d.settings.maxDeliveryKm===undefined){d.settings.maxDeliveryKm=0;changed=true;}
  if(d.settings.storeLat===undefined)d.settings.storeLat='';
  if(d.settings.storeLng===undefined)d.settings.storeLng='';
  if(!Array.isArray(d.orders)){d.orders=[];changed=true;}
  if(!Array.isArray(d.customers)){d.customers=[];changed=true;}
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
function normalizeSearchText(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
function searchWords(v){return normalizeSearchText(v).split(' ').filter(x=>x.length>1)}
function levenshtein(a,b){
  a=normalizeSearchText(a);b=normalizeSearchText(b);
  if(!a)return b.length;if(!b)return a.length;
  const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);
  for(let i=1;i<=a.length;i++){cur[0]=i;for(let k=1;k<=b.length;k++)cur[k]=Math.min(cur[k-1]+1,prev[k]+1,prev[k-1]+(a[i-1]===b[k-1]?0:1));for(let k=0;k<=b.length;k++)prev[k]=cur[k]}
  return prev[b.length];
}
function searchSimilarity(a,b){
  a=normalizeSearchText(a);b=normalizeSearchText(b);if(!a||!b)return 0;if(a.includes(b)||b.includes(a))return .96;
  const d=levenshtein(a,b);return Math.max(0,1-d/Math.max(a.length,b.length));
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

  // Tabela por faixas fechadas: o cliente paga o valor da primeira faixa
  // cujo limite inclui a distância da rota. Ex.: 2,1 a 4 km = valor de 4 km.
  for(const range of active){
    if(d<=Number(range.maxKm))return Math.round(Number(range.fee||0)*100)/100;
  }
  const last=active[active.length-1];
  const extra=Number(settings.extraKmFee||0);
  if(extra<=0)return null;
  return Math.round((Number(last.fee||0)+(d-Number(last.maxKm))*extra)*100)/100;
}

// Distância real pelas ruas. Por padrão usa OSRM; em produção pode apontar ROUTING_BASE_URL para sua própria instância/provedor compatível.
async function roadRouteKm(storeLat,storeLng,customerLat,customerLng){
  const vals=[storeLat,storeLng,customerLat,customerLng].map(Number);
  if(vals.some(v=>!Number.isFinite(v)))throw new Error('Coordenadas inválidas');
  const [a,b,c,d]=vals;
  // O roteador público principal pode oscilar. Tentamos uma segunda instância
  // compatível antes de devolver erro ao cliente. Nenhum cálculo em linha reta
  // é usado para cobrar a entrega.
  const configured=String(process.env.ROUTING_BASE_URL||'').trim().replace(/\/$/,'');
  const bases=[configured,'https://router.project-osrm.org','https://routing.openstreetmap.de/routed-car']
    .filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);
  let lastError=null;
  for(const base of bases){
    const url=`${base}/route/v1/driving/${b},${a};${d},${c}?overview=false&steps=false`;
    const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),9000);
    try{
      const r=await fetch(url,{headers:{'User-Agent':'CHEFE-TELLES/10.49'},signal:ctrl.signal});
      if(!r.ok){lastError=new Error('Roteador temporariamente indisponível');continue;}
      const j=await r.json(); const meters=Number(j?.routes?.[0]?.distance);
      if(!Number.isFinite(meters)||meters<100){lastError=new Error('Não foi encontrada uma rota válida pelas ruas.');continue;}
      return {km:meters/1000,source:'road'};
    }catch(e){
      lastError=e?.name==='AbortError'?new Error('A rota demorou para responder.'):e;
    }finally{clearTimeout(timer);}
  }
  throw new Error(lastError?.message||'Não foi possível calcular a rota agora. Tente novamente.');
}


// Para endereço digitado, encaixa a coordenada geocodificada na via dirigível mais
// próxima antes de calcular a rota. GPS/mapa continuam usando o ponto escolhido.
async function snapAddressPointToRoad(lat,lng){
  const la=Number(lat),lo=Number(lng);
  if(!Number.isFinite(la)||!Number.isFinite(lo))throw Error('Coordenada de entrega inválida.');
  const configured=String(process.env.ROUTING_BASE_URL||'').trim().replace(/\/$/,'');
  const bases=[configured,'https://router.project-osrm.org','https://routing.openstreetmap.de/routed-car']
    .filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);
  let best=null;
  for(const base of bases){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),6500);
    try{
      const r=await fetch(`${base}/nearest/v1/driving/${lo},${la}?number=1`,{headers:{'User-Agent':'CHEFE-TELLES/10.55'},signal:ctrl.signal});
      if(!r.ok)continue;
      const j=await r.json(),w=j?.waypoints?.[0],p=w?.location,dist=Number(w?.distance);
      if(!Array.isArray(p)||p.length!==2)continue;
      const found={lat:Number(p[1]),lng:Number(p[0]),distance:Number.isFinite(dist)?dist:999999};
      if(!best||found.distance<best.distance)best=found;
      if(found.distance<=120)break;
    }catch{}finally{clearTimeout(timer);}
  }
  if(!best)return {lat:la,lng:lo};
  if(best.distance>500)throw Error('O endereço foi localizado, mas ficou longe de uma rua trafegável. Confira o endereço ou use Minha localização.');
  return {lat:best.lat,lng:best.lng};
}
async function deliveryKmForTypedAddress(settings,lat,lng){
  const p=await snapAddressPointToRoad(lat,lng);
  const route=await deliveryKm(settings,p.lat,p.lng);
  return {...route,lat:p.lat,lng:p.lng};
}

async function lookupCep(cep){
  const c=String(cep||'').replace(/\D/g,''); if(c.length!==8) throw Error('CEP inválido.');
  const r=await fetch(`https://viacep.com.br/ws/${c}/json/`,{headers:{'User-Agent':'CHEFE-TELLES/9.2'}}); if(!r.ok) throw Error('Não foi possível consultar o CEP.');
  const j=await r.json(); if(j.erro) throw Error('CEP não encontrado.');
  return {cep:j.cep||c,street:j.logradouro||'',neighborhood:j.bairro||'',city:j.localidade||'',state:j.uf||''};
}

async function googleGeocodeBrazilAddress(x){
  const key=String(process.env.GOOGLE_MAPS_API_KEY||'').trim();
  if(!key)return null;
  const street=String(x.street||'').trim(), number=String(x.number||'').trim();
  const neighborhood=String(x.neighborhood||'').trim(), city=String(x.city||'').trim();
  const state=String(x.state||'').trim(), cep=String(x.cep||'').replace(/\D/g,'');
  const address=[street,number,neighborhood,city,state,cep,'Brasil'].filter(Boolean).join(', ');
  try{
    const p=new URLSearchParams({address,key,region:'br',language:'pt-BR'});
    const r=await fetch('https://maps.googleapis.com/maps/api/geocode/json?'+p.toString(),{signal:AbortSignal.timeout(7000)});
    if(!r.ok)return null;
    const j=await r.json();
    if(j.status==='REQUEST_DENIED')throw Error('Google Geocoding recusou a chave/API. Verifique a chave e se a Geocoding API está ativada.');
    if(j.status==='OVER_QUERY_LIMIT')throw Error('Limite do Google Geocoding atingido.');
    if(j.status!=='OK'||!j.results?.length)return null;
    const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const get=(res,type)=>{
      const c=(res.address_components||[]).find(a=>(a.types||[]).includes(type));
      return c?.short_name||c?.long_name||'';
    };
    const candidates=j.results.filter(res=>{
      const cCity=get(res,'administrative_area_level_2')||get(res,'locality');
      const cState=get(res,'administrative_area_level_1');
      const cityOk=!city||!cCity||norm(cCity)===norm(city);
      const stateOk=!state||!cState||norm(cState)===norm(state)||norm(cState).endsWith(norm(state));
      return cityOk&&stateOk;
    });
    const best=candidates[0]||j.results[0], loc=best?.geometry?.location;
    const lat=Number(loc?.lat),lng=Number(loc?.lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
    return {lat,lng,displayName:best.formatted_address||address,precision:'google'};
  }catch(e){
    if(String(e?.message||'').includes('Google Geocoding')||String(e?.message||'').includes('Limite do Google'))throw e;
    return null;
  }
}

function addressCacheKey(x){
  return [x.state,x.city,x.neighborhood,x.street,x.number].map(normalizeDeliveryText).join('|');
}
function findCachedAddress(cache,x){
  const wantedStreet=normalizeDeliveryText(x.street), wantedNb=normalizeDeliveryText(x.neighborhood);
  const wantedCity=normalizeDeliveryText(x.city), wantedState=normalizeDeliveryText(x.state);
  const wantedNum=normalizeDeliveryText(x.number);
  const rows=(cache||[]).filter(c=>{
    if(wantedCity&&normalizeDeliveryText(c.city)!==wantedCity)return false;
    if(wantedState&&normalizeDeliveryText(c.state)!==wantedState)return false;
    if(wantedStreet&&searchSimilarity(wantedStreet,c.street)<.96)return false;
    if(wantedNb&&c.neighborhood&&searchSimilarity(wantedNb,c.neighborhood)<.72)return false;
    if(wantedNum&&normalizeDeliveryText(c.number)!==wantedNum)return false;
    return true;
  }).sort((a,b)=>{
    const an=normalizeDeliveryText(a.number),bn=normalizeDeliveryText(b.number);
    return (bn===wantedNum)-(an===wantedNum) || Number(b.hits||0)-Number(a.hits||0);
  });
  const c=rows[0];
  if(!c)return null;
  return {lat:Number(c.lat),lng:Number(c.lng),displayName:c.displayName||[c.street,c.number,c.neighborhood,c.city,c.state].filter(Boolean).join(', '),precision:'cache'};
}
function learnAddress(d,input,geo){
  if(!d||!geo||!Number.isFinite(Number(geo.lat))||!Number.isFinite(Number(geo.lng)))return;
  d.addressCache=Array.isArray(d.addressCache)?d.addressCache:[];
  const row={street:String(input.street||'').trim(),number:String(input.number||'').trim(),neighborhood:String(input.neighborhood||'').trim(),city:String(input.city||'').trim(),state:String(input.state||'').trim().toUpperCase(),cep:String(input.cep||'').replace(/\D/g,''),lat:Number(geo.lat),lng:Number(geo.lng),displayName:String(geo.displayName||''),updatedAt:new Date().toISOString()};
  if(!row.street||!row.city)return;
  const key=addressCacheKey(row),i=d.addressCache.findIndex(c=>addressCacheKey(c)===key);
  if(i>=0)d.addressCache[i]={...d.addressCache[i],...row,hits:Number(d.addressCache[i].hits||0)+1};
  else d.addressCache.push({...row,hits:1});
  if(d.addressCache.length>1000)d.addressCache=d.addressCache.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,1000);
}

async function geocodeBrazilAddress(x,cache=[]){
  // V10.48: modo gratuito. Endereço manual usa os provedores públicos abaixo.
  // Google não é obrigatório e uma chave recusada nunca bloqueia o cadastro/entrega.
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

  const cached=findCachedAddress(cache,{street,number,neighborhood,city,state});
  if(cached)return cached;

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
    [street,city,state,cep,'Brasil'],
    [street,number,city,state,'Brasil'],
    [street,city,state,'Brasil'],
    [street,number,city,'Brasil'],
    [street,city,'Brasil']
  ].map(v=>v.filter(Boolean).join(', ')).filter((v,i,a)=>v&&a.indexOf(v)===i);

  let candidates=[];
  for(const q of queries){
    try{
      const params=new URLSearchParams({format:'jsonv2',addressdetails:'1',limit:'50',countrycodes:'br',q});
      // Quando a loja possui coordenadas, a consulta é enviesada para a região local.
      // O filtro de cidade/UF abaixo continua sendo a proteção definitiva.
      const r=await fetch('https://nominatim.openstreetmap.org/search?'+params.toString(),{headers,signal:AbortSignal.timeout(6500)}); if(!r.ok)continue;
      const arr=await r.json(); candidates.push(...arr);
    }catch{}
  }
  if(!candidates.length){
    const dl=Number(x.directoryLat),dn=Number(x.directoryLng);
    if(Number.isFinite(dl)&&Number.isFinite(dn))return {lat:dl,lng:dn,displayName:[street,neighborhood,city,state].filter(Boolean).join(', '),precision:'street-reference'};
    if(cepPoint)return {lat:cepPoint.lat,lng:cepPoint.lng,displayName:[street,neighborhood,city,state,cep].filter(Boolean).join(', '),precision:'cep-reference'};
    throw Error('Não conseguimos localizar essa rua no mapa. Use Minha localização ou confirme o ponto no mapa.');
  }

  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const hav=(a,b,c,d)=>{const R=6371,toRad=v=>v*Math.PI/180,dl=toRad(c-a),dn=toRad(d-b);const z=Math.sin(dl/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(z));};
  // Nunca deixar um homônimo de outra cidade/UF vencer o ranking.
  candidates=candidates.filter(c=>{
    const a=c.address||{};
    const cc=a.city||a.town||a.municipality||a.village||'';
    const cs=a.state_code||a['ISO3166-2-lvl4']?.split('-').pop()||a.state||'';
    const cityOk=!city||!cc||norm(cc)===norm(city);
    const wantedState=norm(state),gotState=norm(cs);
    const stateOk=!state||!cs||gotState===wantedState||gotState.endsWith('-'+wantedState);
    return cityOk&&stateOk;
  });
  if(!candidates.length){const dl=Number(x.directoryLat),dn=Number(x.directoryLng);if(Number.isFinite(dl)&&Number.isFinite(dn))return {lat:dl,lng:dn,displayName:[street,neighborhood,city,state].filter(Boolean).join(', '),precision:'street-reference'};if(cepPoint)return {lat:cepPoint.lat,lng:cepPoint.lng,displayName:[street,neighborhood,city,state,cep].filter(Boolean).join(', '),precision:'cep-reference'};throw Error('Não conseguimos localizar essa rua no mapa. Use Minha localização ou confirme o ponto no mapa.');}

  const scored=candidates.map(c=>{
    const a=c.address||{}; let score=0;
    const cCity=a.city||a.town||a.municipality||a.village||'';
    const cNb=a.suburb||a.neighbourhood||a.quarter||a.city_district||'';
    const cRoad=a.road||a.pedestrian||a.residential||'';
    const cPost=String(a.postcode||'').replace(/\D/g,'');
    if(city&&norm(cCity)===norm(city))score+=70;
    if(neighborhood){const sim=searchSimilarity(neighborhood,cNb);score+=Math.round(sim*85);if(norm(cNb)===norm(neighborhood))score+=65}
    if(street){const sim=searchSimilarity(street,cRoad);score+=Math.round(sim*90);if(norm(cRoad)===norm(street))score+=70}
    if(street&&neighborhood&&norm(cRoad)===norm(street)&&norm(cNb)===norm(neighborhood))score+=120;
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
  if(street && bestRoad && searchSimilarity(street,bestRoad)<.60 && !norm(best.display_name).includes(norm(street))){
    const dl=Number(x.directoryLat),dn=Number(x.directoryLng);
    if(Number.isFinite(dl)&&Number.isFinite(dn))return {lat:dl,lng:dn,displayName:[street,neighborhood,city,state].filter(Boolean).join(', '),precision:'street-reference'};
    if(cepPoint)return {lat:cepPoint.lat,lng:cepPoint.lng,displayName:[street,neighborhood,city,state,cep].filter(Boolean).join(', '),precision:'cep-reference'};
    throw Error('O mapa encontrou outra rua. Use Minha localização ou confirme o ponto correto no mapa.');
  }
  // O bairro digitado continua pesando no ranking, mas não bloqueia a entrega:
  // bases públicas frequentemente associam uma mesma rua a outro bairro adjacente.
  // A segurança fica na confirmação da rua + cidade/UF e, depois, na rota rodoviária.
  return {lat:Number(best.lat),lng:Number(best.lon),displayName:best.display_name,precision:number?'address':'street'};
}


async function googleReverseGeocodeBrazil(lat,lng){
  const key=String(process.env.GOOGLE_MAPS_API_KEY||'').trim();
  lat=Number(lat);lng=Number(lng);
  if(!key||!Number.isFinite(lat)||!Number.isFinite(lng))return null;
  try{
    const p=new URLSearchParams({latlng:`${lat},${lng}`,key,language:'pt-BR',region:'br'});
    const r=await fetch('https://maps.googleapis.com/maps/api/geocode/json?'+p.toString(),{signal:AbortSignal.timeout(7000)});
    if(!r.ok)return null;
    const j=await r.json();
    if(j.status==='REQUEST_DENIED')throw Error('Google Geocoding recusou a chave/API. Verifique as restrições da chave.');
    if(j.status!=='OK'||!j.results?.length)return null;
    const best=j.results[0];
    const get=(type)=>{const c=(best.address_components||[]).find(a=>(a.types||[]).includes(type));return c?.short_name||c?.long_name||''};
    return {
      lat,lng,
      cep:get('postal_code'),
      street:get('route'),
      number:get('street_number'),
      neighborhood:get('sublocality_level_1')||get('sublocality')||get('neighborhood'),
      city:get('administrative_area_level_2')||get('locality'),
      state:get('administrative_area_level_1'),
      addressFound:best.formatted_address||''
    };
  }catch(e){
    if(String(e?.message||'').includes('Google Geocoding'))throw e;
    return null;
  }
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
  // Thermer/iPhone: uma unica entrada de texto e o formato mais tolerante.
  // O app interpreta <br /> como quebra de linha no conteudo recebido pela Web Print.
  const oneText=(lines,bold=0,align=0,format=0)=>({
    0:{type:0,content:lines.map(x=>String(x??'')).join('<br />'),bold,align,format}
  });
  if(pathname==='/print/test'){
    return send(res,200,oneText([
      'Cheff Telles',
      'TESTE DE IMPRESSAO',
      '--------------------------------',
      'THERMER WEB PRINT OK',
      new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),
      '',
      ''
    ]));
  }
  const m=pathname.match(/^\/print\/(\d+)$/); if(!m)return false;
  const d=await read(),o=d.orders.find(x=>String(x.id)===m[1]); if(!o)return send(res,404,{error:'Pedido nao encontrado'});
  const lines=[];
  lines.push('Cheff Telles');
  lines.push('PEDIDO '+String(o.number).padStart(2,'0'));
  lines.push(new Date(o.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}));
  lines.push('--------------------------------');
  lines.push('STATUS: '+(o.status||'Novo'));
  lines.push('CLIENTE: '+(o.customer?.name||''));
  if(o.customer?.phone)lines.push('WHATSAPP: '+o.customer.phone);
  lines.push('--------------------------------');
  for(const i of (o.items||[])) lines.push(`${i.qty}x ${i.name} - R$ ${(Number(i.price||0)*Number(i.qty||0)).toFixed(2)}`);
  lines.push('--------------------------------');
  lines.push('SUBTOTAL: R$ '+Number(o.subtotal||o.total||0).toFixed(2));
  if(o.customer?.delivery!=='Retirada')lines.push('ENTREGA: R$ '+Number(o.deliveryFee||0).toFixed(2));
  lines.push('TOTAL: R$ '+Number(o.total||0).toFixed(2));
  lines.push('FORMA DE PAGAMENTO: '+(o.customer?.payment||''));
  if(o.customer?.delivery==='Retirada')lines.push('TIPO: RETIRADA NA LOJA');
  else {
    const printAddress=String(o.customer?.address||'').replace(/,?\s*Refer[eê]ncia:\s*.*$/i,'').trim();
    lines.push('ENDERECO: '+printAddress);
    if(o.customer?.reference)lines.push('PONTO DE REFERENCIA: '+o.customer.reference);
  }
  if(o.deliveryDistanceKm)lines.push('DISTANCIA: '+o.deliveryDistanceKm+' km');
  lines.push('OBS: '+(o.customer?.note||'Nenhuma'));
  lines.push(''); lines.push('');
  return send(res,200,oneText(lines));
}

function printAgentAuthorized(req){
  const configured=String(process.env.PRINT_AGENT_KEY||'').trim();
  if(!configured)return false;
  return String(req.headers['x-print-agent-key']||'')===configured;
}

async function api(req,res,pathname){
  try{

    // Cheff Telles Print Android: leitura segura de pedidos para impressão.
    if(req.method==='GET'&&pathname==='/api/print-agent/orders'){
      if(!printAgentAuthorized(req))return send(res,401,{error:'Agente de impressão não autorizado'});
      const d=await read();
      return send(res,200,d.orders.filter(o=>(o.status||'Novo')==='Novo').slice().reverse());
    }

    if(req.method==='GET'&&pathname==='/api/health')return send(res,200,{ok:true,store:'Cheff Telles',version:'2.0.0'});
    if(req.method==='GET'&&pathname==='/api/network'){
      const nets=os.networkInterfaces(), ips=[];
      for(const list of Object.values(nets)) for(const n of (list||[])) if(n.family==='IPv4'&&!n.internal) ips.push(n.address);
      return send(res,200,{ips:[...new Set(ips)]});
    }
    if(req.method==='GET'&&pathname==='/api/store'){
      const d=await read();
      return send(res,200,{settings:{name:d.settings.name,whatsapp:d.settings.whatsapp,pixKey:d.settings.pixKey||'',pixRecipient:d.settings.pixRecipient||'',pixType:d.settings.pixType||'',pixQr:d.settings.pixQr||'',botWhatsapp:d.settings.botWhatsapp||d.settings.whatsapp,botMessage:d.settings.botMessage||'',deliveryMode:'route',storeLat:d.settings.storeLat||'',storeLng:d.settings.storeLng||'',storeCity:d.settings.storeCity||'',storeState:d.settings.storeState||'',storeNeighborhood:d.settings.storeNeighborhood||'',extraKmFee:Number(d.settings.extraKmFee)||0,maxDeliveryKm:Number(d.settings.maxDeliveryKm)||0},categories:d.categories,products:d.products.filter(p=>p.active),deliveryZones:[],addressHints:(d.addressCache||[]).slice(-300).map(a=>({street:a.street,neighborhood:a.neighborhood,city:a.city,state:a.state})),deliveryKmRanges:(d.deliveryKmRanges||[]).filter(z=>z.active!==false)});
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
      const hintStreet=String(searchUrl.searchParams.get('street')||'').trim();
      const hintNumber=String(searchUrl.searchParams.get('number')||'').trim();
      let hintNeighborhood=String(searchUrl.searchParams.get('neighborhood')||'').trim();
      const hintCep=String(searchUrl.searchParams.get('cep')||'').replace(/\D/g,'');
      const bairroMatch=q.match(/^\s*bairro\s+(.+)$/i);
      if(!hintNeighborhood&&bairroMatch)hintNeighborhood=bairroMatch[1].trim();
      const raw=[q,hintStreet,hintNumber,hintNeighborhood].filter(Boolean).join(', ').trim();
      if(raw.length<2)return send(res,200,[]);
      try{
        // V10.55: com bairro informado, o diretório de Jequié é a fonte primária.
        // Evita misturar ruas de outros bairros só porque o nome é parecido.
        if(hintNeighborhood){
          const nb=bestNeighborhoodName(hintNeighborhood),rows=await loadJequieNeighborhood(nb),wanted=normAddress(hintStreet||q);
          const local=rows.map(x=>({x,sim:searchSimilarity(wanted,x.street)}))
            .filter(o=>!wanted||normAddress(o.x.street).includes(wanted)||wanted.includes(normAddress(o.x.street))||o.sim>=.72)
            .sort((a,b)=>b.sim-a.sim).slice(0,25)
            .map(o=>({lat:'',lon:'',display_name:[o.x.street,o.x.neighborhood,'Jequié','BA','Brasil'].join(', '),type:'road',class:'directory',directory:true,cep:o.x.cep,address:{road:o.x.street,suburb:o.x.neighborhood,city:'Jequié',state:'BA',postcode:o.x.cep}}));
          if(local.length)return send(res,200,local);
        }
        const d=await read(),city=String(d.settings.storeCity||'').trim(),state=String(d.settings.storeState||'').trim();
        const storeLat=Number(d.settings.storeLat),storeLng=Number(d.settings.storeLng);
        const headers={'User-Agent':'CHEFE-TELLES/10.31 (resilient unified search)','Accept-Language':'pt-BR'};
        const words=searchWords([q,hintStreet,hintNeighborhood].filter(Boolean).join(' '));
        let cepData=null;
        if(hintCep.length===8){try{cepData=await lookupCep(hintCep)}catch{}}
        const cityHint=city||cepData?.city||'',stateHint=state||cepData?.state||'';
        const typed=[hintStreet||q,hintNumber,hintNeighborhood||cepData?.neighborhood||''].filter(Boolean).join(', ');
        const queries=[
          [typed,cityHint,stateHint,hintCep,'Brasil'],
          [hintStreet||q,hintNeighborhood,cityHint,stateHint,'Brasil'],
          [q,cityHint,stateHint,'Brasil'],
          [hintStreet||q,cityHint,stateHint,'Brasil'],
          [hintNeighborhood||q,cityHint,stateHint,'Brasil'],
          [q,stateHint,'Brasil'],
          [q,'Brasil']
        ].map(v=>v.filter(Boolean).join(', ')).filter((v,i,a)=>v.length>2&&a.indexOf(v)===i);
        let all=[];
        for(const text of queries){
          try{
            const p=new URLSearchParams({format:'jsonv2',addressdetails:'1',limit:'25',countrycodes:'br',q:text});
            if(Number.isFinite(storeLat)&&Number.isFinite(storeLng)){p.set('viewbox',`${storeLng-0.45},${storeLat+0.45},${storeLng+0.45},${storeLat-0.45}`);p.set('bounded','0')}
            const r=await fetch('https://nominatim.openstreetmap.org/search?'+p.toString(),{headers,signal:AbortSignal.timeout(5500)});
            if(r.ok)all.push(...await r.json());
          }catch{}
        }
        // Fallback: roads around store + fuzzy typo matching.
        if(all.length<10&&words.length&&Number.isFinite(storeLat)&&Number.isFinite(storeLng)){
          for(const overpassBase of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']){
            try{
              const oq=`[out:json][timeout:7];way(around:45000,${storeLat},${storeLng})["highway"]["name"];out tags center 1600;`;
              const or=await fetch(overpassBase,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'CHEFE-TELLES/10.31'},body:'data='+encodeURIComponent(oq),signal:AbortSignal.timeout(8000)});
              if(!or.ok)continue;
              const od=await or.json(),seenRoad=new Set();
              for(const x of (od.elements||[])){
                const name=String(x.tags?.name||'').trim(),nn=normalizeSearchText(name),lat=Number(x.center?.lat),lon=Number(x.center?.lon);
                if(!name||!Number.isFinite(lat)||!Number.isFinite(lon)||seenRoad.has(nn))continue;
                const roadWords=searchWords(name);
                const fuzzy=words.every(w=>roadWords.some(rw=>rw.includes(w)||w.includes(rw)||searchSimilarity(w,rw)>=.68));
                if(!fuzzy)continue;
                seenRoad.add(nn);
                all.push({lat:String(lat),lon:String(lon),display_name:[name,hintNeighborhood,cityHint,stateHint,'Brasil'].filter(Boolean).join(', '),type:'road',class:'highway',address:{road:name,neighbourhood:hintNeighborhood,city:cityHint,state:stateHint}});
                if(all.length>=30)break;
              }
              if(all.length>=10)break;
            }catch{}
          }
        }
        const score=x=>{
          const ad=x.address||{},text=normalizeSearchText(x.display_name||''),road=ad.road||ad.pedestrian||ad.residential||'',nb=ad.suburb||ad.neighbourhood||ad.quarter||ad.city_district||'',c=ad.city||ad.town||ad.municipality||ad.village||'';
          let n=0;
          if(cityHint&&normalizeSearchText(c)===normalizeSearchText(cityHint))n+=70;
          if(hintStreet){const sim=searchSimilarity(hintStreet,road);n+=Math.round(sim*85);if(normalizeSearchText(road)===normalizeSearchText(hintStreet))n+=55}
          if(hintNeighborhood){const sim=searchSimilarity(hintNeighborhood,nb);n+=Math.round(sim*90);if(normalizeSearchText(nb)===normalizeSearchText(hintNeighborhood))n+=70}
          if(hintStreet&&hintNeighborhood&&normalizeSearchText(road)===normalizeSearchText(hintStreet)&&normalizeSearchText(nb)===normalizeSearchText(hintNeighborhood))n+=120;
          if(q){const qt=normalizeSearchText(q);if(text.includes(qt))n+=55;else{const qws=searchWords(q),tws=searchWords([road,nb,text].join(' '));n+=qws.reduce((sum,w)=>sum+Math.round(Math.max(0,...tws.map(t=>searchSimilarity(w,t)))*18),0)}}
          if(hintNumber&&String(ad.house_number||'')===hintNumber)n+=18;
          if(hintCep&&String(ad.postcode||'').replace(/\D/g,'')===hintCep)n+=25;
          if(ad.house_number)n+=5;return n;
        };
        // A busca da loja é local: elimina resultados claramente pertencentes a
        // outra cidade/UF antes de exibir qualquer sugestão ao cliente.
        const sameRegion=x=>{
          const ad=x.address||{};
          const c=ad.city||ad.town||ad.municipality||ad.village||'';
          const st=ad.state_code||ad['ISO3166-2-lvl4']?.split('-').pop()||ad.state||'';
          const cOk=!cityHint||!c||normalizeSearchText(c)===normalizeSearchText(cityHint);
          const wantedState=normalizeSearchText(stateHint);
          const gotState=normalizeSearchText(st);
          const sOk=!stateHint||!st||gotState===wantedState||gotState.endsWith('-'+wantedState);
          return cOk&&sOk;
        };
        all=all.filter(sameRegion);
        const seen=new Set();
        const out=all.map(x=>({...x,_score:score(x)})).sort((x,y)=>y._score-x._score).filter(x=>{
          const key=normalizeSearchText(x.display_name)||Number(x.lat).toFixed(5)+','+Number(x.lon).toFixed(5);
          if(seen.has(key))return false;seen.add(key);return true;
        }).slice(0,60).map(x=>{
          const ad=x.address||{},road=ad.road||ad.pedestrian||ad.residential||'',nb=ad.suburb||ad.neighbourhood||ad.quarter||ad.city_district||'';
          return {lat:Number(x.lat),lng:Number(x.lon),label:x.display_name,address:ad,kind:road?'road':(nb?'neighborhood':'place'),road,neighborhood:nb};
        });
        return send(res,200,out);
      }catch(e){return send(res,400,{error:e.message||'Não foi possível buscar endereços.'})}
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

    if(req.method==='GET'&&pathname==='/api/address-suggest-local'){
      const u=new URL(req.url,'http://localhost'),q=String(u.searchParams.get('q')||'').trim(),nq=normAddress(q);
      if(nq.length<2)return send(res,200,[]);
      const out=[],seen=new Set(),push=(x)=>{const k=[x.type,normAddress(x.label),normAddress(x.neighborhood),normAddress(x.street)].join('|');if(!seen.has(k)){seen.add(k);out.push(x)}};
      for(const label of publicNeighborhoods()){
        const nl=normAddress(label),sim=searchSimilarity(nq,nl);
        if(nl.includes(nq)||nq.includes(nl)||sim>=.68)push({type:'locality',label,neighborhood:label,score:nl===nq?120:(nl.startsWith(nq)?110:Math.round(sim*100))});
      }
      for(const x of (jequieBase.entries||[])){
        const ns=normAddress(x.street),nn=normAddress(x.neighborhood),hay=ns+' '+nn+' '+normAddress(x.complement||''),sim=Math.max(searchSimilarity(nq,ns),searchSimilarity(nq,hay));
        if(ns.includes(nq)||nn.includes(nq)||hay.includes(nq)||sim>=.76)push({type:'street',label:x.street,street:x.street,neighborhood:x.neighborhood,cep:x.cep||'',complement:x.complement||'',score:ns===nq?118:(ns.startsWith(nq)?108:Math.round(sim*100))});
      }
      out.sort((a,b)=>(b.score||0)-(a.score||0)||a.label.localeCompare(b.label,'pt-BR'));
      return send(res,200,out.slice(0,40));
    }

    if(req.method==='GET'&&pathname==='/api/address-directory'){
      const directoryUrl=new URL(req.url,'http://localhost');
      const d=await read(),rawNb=String(directoryUrl.searchParams.get('neighborhood')||'').trim(),nb=bestNeighborhoodName(rawNb);
      if(!rawNb)return send(res,200,{neighborhoods:publicNeighborhoods(),streets:[],selectedNeighborhood:''});
      const rows=await loadJequieNeighborhood(rawNb);const streets=[...new Set(rows.map(x=>x.street).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
      return send(res,200,{neighborhoods:publicNeighborhoods(),streets,selectedNeighborhood:rawNb,postalNeighborhood:nb});
    }

    const cepMatch=pathname.match(/^\/api\/cep\/(\d{8})$/);
    if(req.method==='GET'&&cepMatch){try{return send(res,200,await lookupCep(cepMatch[1]));}catch(e){return send(res,404,{error:e.message});}}
    if(req.method==='POST'&&pathname==='/api/delivery-quote-address'){
      const b=await body(req),d=await read();
      if(!String(b.street||'').trim()||!String(b.neighborhood||'').trim())
        return send(res,400,{error:'Informe rua e bairro/localidade para calcular a entrega.'});
      // O número é detalhe de entrega e não participa da geocodificação/rota.
      b.number='';
      let addressInput={...b,city:String(b.city||d.settings.storeCity||'Jequié').trim(),state:String(b.state||d.settings.storeState||'BA').trim()};
      try{
        addressInput=await enrichJequieAddress(addressInput);
        const geo=await geocodeBrazilAddress(addressInput,d.addressCache);
        const route=await deliveryKmForTypedAddress(d.settings,geo.lat,geo.lng);
        learnAddress(d,addressInput,geo); await write(d);
        const fee=resolveKmFee(d.deliveryKmRanges,route.km,d.settings);
        if(fee===null)return send(res,400,{error:'Endereço fora da distância máxima de entrega.',distanceKm:Number(route.km.toFixed(2))});
        return send(res,200,{lat:route.lat??geo.lat,lng:route.lng??geo.lng,addressFound:geo.displayName,distanceKm:Number(route.km.toFixed(2)),deliveryFee:fee,routeType:route.source,locationPrecision:geo.precision||'address'});
      }catch(e){return send(res,400,{error:e.message||'Não foi possível calcular a entrega pelo endereço.'});}
    }
    if(req.method==='POST'&&pathname==='/api/delivery-quote'){
      const b=await body(req),d=await read();
      if(!d.settings.storeLat||!d.settings.storeLng||!b.lat||!b.lng)return send(res,400,{error:'Localização da loja ou cliente não informada.'});
      try{
        const route=await deliveryKm(d.settings,b.lat,b.lng), fee=resolveKmFee(d.deliveryKmRanges,route.km,d.settings);
        if(fee===null)return send(res,400,{error:'Localização fora da distância máxima de entrega.',distanceKm:Number(route.km.toFixed(2))});
        return send(res,200,{distanceKm:Number(route.km.toFixed(2)),deliveryFee:fee,routeType:route.source});
      }catch(e){
        return send(res,400,{error:e.message||'Não foi possível calcular a rota da entrega agora.'});
      }
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
        let lat=Number(b.customer?.lat),lng=Number(b.customer?.lng),typedAddressGeocoded=false;
        if(!Number.isFinite(lat)||!Number.isFinite(lng)||!lat||!lng){
          try{
            let addressInput={...b.customer,city:String(b.customer?.city||d.settings.storeCity||'Jequié').trim(),state:String(b.customer?.state||d.settings.storeState||'BA').trim()};
            addressInput=await enrichJequieAddress(addressInput);
            const geo=await geocodeBrazilAddress(addressInput,d.addressCache);
            lat=geo.lat;lng=geo.lng;b.customer.lat=lat;b.customer.lng=lng;b._learnAddress={input:addressInput,geo};typedAddressGeocoded=true;
          }catch(e){return send(res,400,{error:e.message||'Não foi possível localizar o endereço para calcular a entrega.'});}
        }
        const route=typedAddressGeocoded?await deliveryKmForTypedAddress(d.settings,lat,lng):await deliveryKm(d.settings,lat,lng);
        if(b._learnAddress){learnAddress(d,b._learnAddress.input,b._learnAddress.geo);delete b._learnAddress;}
        const resolved=resolveKmFee(d.deliveryKmRanges,route.km,d.settings);
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
      const order={...b,customer,id:Date.now(),trackingToken:crypto.randomBytes(16).toString('hex'),estimatedMinutes:Number(d.settings.defaultEtaMinutes||0),day:today,number:count,status:'Novo',statusHistory:[{status:'Novo',at:createdAt}],driverId:null,estimatedMinutes:Number(d.settings.defaultEtaMinutes||0),createdAt,createdAtText,subtotal,deliveryFee,total:subtotal+deliveryFee};
      d.orders.push(order);await write(d);return send(res,201,order);
    }

    const tm=pathname.match(/^\/api\/track\/([a-f0-9]{32})$/i);
    if(tm&&req.method==='GET'){
      const d=await read(),o=d.orders.find(x=>String(x.trackingToken||'')===tm[1]);
      if(!o)return send(res,404,{error:'Pedido não encontrado'});
      const driver=(d.drivers||[]).find(x=>String(x.id)===String(o.driverId||''));
      return send(res,200,{number:o.number,status:o.status||'Novo',createdAt:o.createdAt,createdAtText:o.createdAtText,estimatedMinutes:Number(o.estimatedMinutes||0),customer:{name:o.customer?.name||'',delivery:o.customer?.delivery||'',address:o.customer?.address||'',payment:o.customer?.payment||''},items:o.items||[],subtotal:Number(o.subtotal||0),deliveryFee:Number(o.deliveryFee||0),total:Number(o.total||0),driver:driver?{name:driver.name||'',phone:driver.phone||''}:null});
    }

    if(!auth(req)) return send(res,401,{error:'Não autorizado'});

    if(req.method==='POST'&&pathname==='/api/store-location/reverse'){
      const b=await body(req);
      try{
        return send(res,200,{...(await reverseGeocodeBrazil(b.lat,b.lng)),source:'osm'});
      }catch(e){return send(res,400,{error:e.message||'Não foi possível preencher o endereço pelo GPS.'});}
    }

    if(req.method==='POST'&&pathname==='/api/store-location/resolve'){
      const b=await body(req),d=await read();
      try{const input=await enrichJequieAddress({...b,city:b.city||'Jequié',state:b.state||'BA'});const geo=await geocodeBrazilAddress(input,d.addressCache||[]);learnAddress(d,input,geo);await write(d);return send(res,200,{lat:geo.lat,lng:geo.lng,addressFound:geo.displayName,source:input.directoryMatch?'diretorio-jequie':(geo.precision||'free')});}
      catch(e){return send(res,400,{error:e.message||'Não foi possível localizar o endereço da loja.'});}
    }

    if(req.method==='GET'&&pathname==='/api/admin'){ const d=await read(); return send(res,200,d); }
    if(req.method==='PUT'&&pathname==='/api/settings'){
      const b=await body(req),d=await read();if(b.adminPassword!==undefined&&String(b.adminPassword).trim()==='') delete b.adminPassword; d.settings={...d.settings,...b,deliveryMode:'route'}; await write(d); return send(res,200,{ok:true});
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
    if(req.method==='PUT'&&pathname==='/api/delivery-km-table'){const b=await body(req),d=await read();const rows=Array.isArray(b.ranges)?b.ranges:[];if(!rows.length)return send(res,400,{error:'Informe a tabela de entrega'});d.deliveryKmRanges=rows.map((x,i)=>({id:Number(x.id)||Date.now()+i,maxKm:Number(x.maxKm)||0,fee:Number(x.fee)||0,active:true})).filter(x=>x.maxKm>0).sort((a,b)=>a.maxKm-b.maxKm);if(!d.deliveryKmRanges.length)return send(res,400,{error:'Tabela inválida'});await write(d);return send(res,200,{ok:true,deliveryKmRanges:d.deliveryKmRanges});}
    if(req.method==='POST'&&pathname==='/api/delivery-km-defaults'){const d=await read();d.deliveryKmRanges=[{id:1001,maxKm:1,fee:5,active:true},{id:1002,maxKm:2,fee:8,active:true},{id:1003,maxKm:4,fee:10,active:true},{id:1004,maxKm:6,fee:12,active:true},{id:1005,maxKm:8,fee:15,active:true},{id:1006,maxKm:9,fee:18,active:true}];d.settings.maxDeliveryKm=9;d.settings.extraKmFee=0;await write(d);return send(res,200,{ok:true,deliveryKmRanges:d.deliveryKmRanges,settings:d.settings});}
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
  server.listen(port,'0.0.0.0',()=>console.log(`\nCheff Telles v2.0 — servidor online\nLoja:   http://localhost:${port}/\nDono:   http://localhost:${port}/admin\nThermer: http://localhost:${port}/thermer-test.html\n`));
}
listenOnAvailablePort(server, PORT);
