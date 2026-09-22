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
  if(!d.settings.deliveryMode){d.settings.deliveryMode='bairro';changed=true;}
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
function resolveKmFee(ranges,km){const r=(ranges||[]).filter(x=>x.active!==false).sort((a,b)=>Number(a.maxKm)-Number(b.maxKm)).find(x=>km<=Number(x.maxKm));return r?Number(r.fee)||0:null;}

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
    if(!Number.isFinite(meters))throw new Error('Rota não encontrada');
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
  const cep=String(x.cep||'').replace(/\D/g,''); let city='',state='';
  if(cep.length===8){try{const c=await lookupCep(cep);city=c.city;state=c.state;if(!x.street)x.street=c.street;if(!x.neighborhood)x.neighborhood=c.neighborhood;}catch{}}
  const parts=[x.street,x.number,x.neighborhood,city,state,cep,'Brasil'].filter(Boolean).join(', ');
  const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q='+encodeURIComponent(parts);
  const r=await fetch(url,{headers:{'User-Agent':'CHEFE-TELLES/9.2 (delivery geocoder)','Accept-Language':'pt-BR'}}); if(!r.ok) throw Error('Serviço de endereço indisponível.');
  let j=await r.json();
  if(!j.length && x.street){const fallback=[x.street,x.neighborhood,city,state,cep,'Brasil'].filter(Boolean).join(', ');const r2=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q='+encodeURIComponent(fallback),{headers:{'User-Agent':'CHEFE-TELLES/9.2 (delivery geocoder)','Accept-Language':'pt-BR'}});j=await r2.json();}
  if(!j.length) throw Error('Não encontramos esse endereço. Confira CEP, rua, bairro e número.');
  return {lat:Number(j[0].lat),lng:Number(j[0].lon),displayName:j[0].display_name};
}

async function deliveryKm(settings,lat,lng){
  try{return await roadRouteKm(settings.storeLat,settings.storeLng,lat,lng)}
  catch(e){return {km:haversineKm(settings.storeLat,settings.storeLng,lat,lng),source:'fallback'}}
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
  addText(e,'--------------------------------'); addText(e,'SUBTOTAL: R$ '+Number(o.subtotal||o.total||0).toFixed(2)); addText(e,'ENTREGA: R$ '+Number(o.deliveryFee||0).toFixed(2)); addText(e,'TOTAL: R$ '+Number(o.total||0).toFixed(2),1,0,1); addText(e,'PAGAMENTO: '+(o.customer?.payment||'')); addText(e,'ENDEREÇO: '+(o.customer?.address||'')); if(o.deliveryDistanceKm)addText(e,'DISTÂNCIA: '+o.deliveryDistanceKm+' km'); addText(e,'OBS: '+(o.customer?.note||'Nenhuma')); addText(e,' '); addText(e,' ');
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
      return send(res,200,{settings:{name:d.settings.name,whatsapp:d.settings.whatsapp,pixKey:d.settings.pixKey||'',pixRecipient:d.settings.pixRecipient||'',pixType:d.settings.pixType||'',pixQr:d.settings.pixQr||'',botWhatsapp:d.settings.botWhatsapp||d.settings.whatsapp,botMessage:d.settings.botMessage||'',deliveryMode:d.settings.deliveryMode||'bairro',storeLat:d.settings.storeLat||'',storeLng:d.settings.storeLng||''},categories:d.categories,products:d.products.filter(p=>p.active),deliveryZones:d.deliveryZones.filter(z=>z.active!==false),deliveryKmRanges:(d.deliveryKmRanges||[]).filter(z=>z.active!==false)});
    }
    if(req.method==='POST'&&pathname==='/api/login'){
      const b=await body(req),d=await read();
      if(String(b.password||'')!==String(d.settings.adminPassword)) return send(res,401,{ok:false,error:'Senha incorreta'});
      const token=crypto.randomBytes(24).toString('hex'); adminTokens.add(token); return send(res,200,{ok:true,token});
    }
    if(req.method==='POST'&&pathname==='/api/logout'){const h=req.headers.authorization||''; if(h.startsWith('Bearer '))adminTokens.delete(h.slice(7)); return send(res,200,{ok:true});}

    const cepMatch=pathname.match(/^\/api\/cep\/(\d{8})$/);
    if(req.method==='GET'&&cepMatch){try{return send(res,200,await lookupCep(cepMatch[1]));}catch(e){return send(res,404,{error:e.message});}}
    if(req.method==='POST'&&pathname==='/api/delivery-quote-address'){
      const b=await body(req),d=await read(); if((d.settings.deliveryMode||'bairro')!=='km')return send(res,400,{error:'Entrega por km não está ativa.'});
      if(!String(b.street||'').trim()||!String(b.number||'').trim())return send(res,400,{error:'Informe rua e número para calcular a entrega.'});
      try{const geo=await geocodeBrazilAddress(b);const route=await deliveryKm(d.settings,geo.lat,geo.lng),fee=resolveKmFee(d.deliveryKmRanges,route.km);if(fee===null)return send(res,400,{error:'Endereço fora da área de entrega cadastrada.',distanceKm:Number(route.km.toFixed(2))});return send(res,200,{lat:geo.lat,lng:geo.lng,addressFound:geo.displayName,distanceKm:Number(route.km.toFixed(2)),deliveryFee:fee,routeType:route.source});}catch(e){return send(res,400,{error:e.message||'Não foi possível calcular a entrega pelo endereço.'});}
    }
    if(req.method==='POST'&&pathname==='/api/delivery-quote'){
      const b=await body(req),d=await read();
      if((d.settings.deliveryMode||'bairro')!=='km')return send(res,400,{error:'Entrega por km não está ativa.'});
      if(!d.settings.storeLat||!d.settings.storeLng||!b.lat||!b.lng)return send(res,400,{error:'Localização da loja ou cliente não informada.'});
      const route=await deliveryKm(d.settings,b.lat,b.lng), fee=resolveKmFee(d.deliveryKmRanges,route.km);
      if(fee===null)return send(res,400,{error:'Localização fora da área de entrega cadastrada.',distanceKm:Number(route.km.toFixed(2))});
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
        if((d.settings.deliveryMode||'bairro')==='km' && b.customer?.lat && b.customer?.lng && d.settings.storeLat && d.settings.storeLng){
          const route=await deliveryKm(d.settings,b.customer.lat,b.customer.lng); const resolved=resolveKmFee(d.deliveryKmRanges,route.km);
          if(resolved===null)return send(res,400,{error:'Localização fora da área de entrega cadastrada.'}); deliveryFee=resolved; b.deliveryDistanceKm=Number(route.km.toFixed(2)); b.deliveryRouteType=route.source;
        }else{
          const resolved=resolveDeliveryFee(d.deliveryZones,b.customer?.neighborhood,b.customer?.street);
          if(resolved===null)return send(res,400,{error:'Bairro/rua sem taxa de entrega cadastrada.'}); deliveryFee=resolved;
        }
      }
      const customer={...(b.customer||{})};
      if(customer.delivery!=='Retirada'){
        const street=String(customer.street||'').trim(), number=String(customer.number||'').trim(), complement=String(customer.complement||'').trim(), neighborhood=String(customer.neighborhood||'').trim(), reference=String(customer.reference||'').trim();
        customer.address=[street,number&&('Nº '+number),neighborhood,complement,reference&&('Referência: '+reference)].filter(Boolean).join(', ');
      }else customer.address='Retirada na loja';
      const order={...b,customer,id:Date.now(),day:today,number:count,status:'Novo',statusHistory:[{status:'Novo',at:new Date().toISOString()}],driverId:null,estimatedMinutes:Number(d.settings.defaultEtaMinutes||0),createdAt:new Date().toISOString(),subtotal,deliveryFee,total:subtotal+deliveryFee};
      d.orders.push(order);await write(d);return send(res,201,order);
    }

    if(!auth(req)) return send(res,401,{error:'Não autorizado'});

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
