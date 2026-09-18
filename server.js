const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const os = require('os');

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
  orders: []
};

if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify(seed, null, 2));
function read(){ try { const d=JSON.parse(fs.readFileSync(DB,'utf8')); let changed=false; if(!Array.isArray(d.categories)){d.categories=['Hambúrgueres','Pizzas','Combos','Bebidas','Açaí na Garrafa'];changed=true;} if(!d.categories.includes('Açaí na Garrafa')){d.categories.push('Açaí na Garrafa');changed=true;} if(!Array.isArray(d.deliveryZones)){d.deliveryZones=[];changed=true;} if(!Array.isArray(d.orders)){d.orders=[];changed=true;} if(!d.products.some(p=>p.cat==='Açaí na Garrafa')){d.products.push({id:Date.now()+17,name:'Açaí na Garrafa 300ml',cat:'Açaí na Garrafa',price:12,emoji:'',desc:'Açaí cremoso servido na garrafa.',image:'',active:true});changed=true;} if(changed) fs.writeFileSync(DB,JSON.stringify(d,null,2)); return d; } catch(e) { return JSON.parse(JSON.stringify(seed)); } }
function write(d){ fs.writeFileSync(DB, JSON.stringify(d,null,2)); }
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

async function printEndpoint(req,res,pathname){
  if(req.method!=='GET') return false;
  if(pathname==='/print/test'){
    const e=[]; addText(e,'CHEFE TELLES',1,1,2); addText(e,'TESTE DE IMPRESSÃO',1,1,1); addText(e,'--------------------------------'); addText(e,'Android / Thermer OK'); addText(e,'iPhone / bprint OK'); addText(e,'PC / QZ Tray OK'); addText(e,' '); addText(e,' ');
    return send(res,200,JSON.parse(printJson(e)));
  }
  const m=pathname.match(/^\/print\/(\d+)$/); if(!m)return false;
  const d=read(),o=d.orders.find(x=>String(x.id)===m[1]); if(!o)return send(res,404,{error:'Pedido não encontrado'});
  const e=[]; addText(e,'CHEFE TELLES',1,1,2); addText(e,'NOVO PEDIDO '+String(o.number).padStart(2,'0'),1,1,1); addText(e,'--------------------------------');
  addText(e,'CLIENTE: '+(o.customer?.name||'')); if(o.customer?.phone)addText(e,'WHATSAPP: '+o.customer.phone); addText(e,'--------------------------------');
  for(const i of (o.items||[])) addText(e,`${i.qty}x ${i.name} - R$ ${(Number(i.price||0)*Number(i.qty||0)).toFixed(2)}`);
  addText(e,'--------------------------------'); addText(e,'SUBTOTAL: R$ '+Number(o.subtotal||o.total||0).toFixed(2)); addText(e,'ENTREGA: R$ '+Number(o.deliveryFee||0).toFixed(2)); addText(e,'TOTAL: R$ '+Number(o.total||0).toFixed(2),1,0,1); addText(e,'PAGAMENTO: '+(o.customer?.payment||'')); addText(e,'ENDEREÇO: '+(o.customer?.address||'')); addText(e,'OBS: '+(o.customer?.note||'Nenhuma')); addText(e,' '); addText(e,' ');
  return send(res,200,JSON.parse(printJson(e)));
}

async function api(req,res,pathname){
  try{
    if(req.method==='GET'&&pathname==='/api/health')return send(res,200,{ok:true,store:'CHEFE TELLES',version:'2.0.0'});
    if(req.method==='GET'&&pathname==='/api/network'){
      const nets=os.networkInterfaces(), ips=[];
      for(const list of Object.values(nets)) for(const n of (list||[])) if(n.family==='IPv4'&&!n.internal) ips.push(n.address);
      return send(res,200,{ips:[...new Set(ips)]});
    }
    if(req.method==='GET'&&pathname==='/api/store'){
      const d=read();
      return send(res,200,{settings:{name:d.settings.name,whatsapp:d.settings.whatsapp},categories:d.categories,products:d.products.filter(p=>p.active),deliveryZones:d.deliveryZones.filter(z=>z.active!==false)});
    }
    if(req.method==='POST'&&pathname==='/api/login'){
      const b=await body(req),d=read();
      if(String(b.password||'')!==String(d.settings.adminPassword)) return send(res,401,{ok:false,error:'Senha incorreta'});
      const token=crypto.randomBytes(24).toString('hex'); adminTokens.add(token); return send(res,200,{ok:true,token});
    }
    if(req.method==='POST'&&pathname==='/api/logout'){const h=req.headers.authorization||''; if(h.startsWith('Bearer '))adminTokens.delete(h.slice(7)); return send(res,200,{ok:true});}

    if(req.method==='POST'&&pathname==='/api/orders'){
      const b=await body(req),d=read(),today=localDay();
      const count=d.orders.filter(o=>o.day===today).length+1;
      const subtotal=Number(b.subtotal ?? b.total ?? 0);
      let deliveryFee=0;
      if(b.customer?.delivery==='Retirada'){
        deliveryFee=0;
      }else{
        const resolved=resolveDeliveryFee(d.deliveryZones,b.customer?.neighborhood,b.customer?.street);
        if(resolved===null)return send(res,400,{error:'Bairro/rua sem taxa de entrega cadastrada.'});
        deliveryFee=resolved;
      }
      const customer={...(b.customer||{})};
      if(customer.delivery!=='Retirada'){
        const street=String(customer.street||'').trim(), number=String(customer.number||'').trim(), complement=String(customer.complement||'').trim(), neighborhood=String(customer.neighborhood||'').trim();
        customer.address=[street,number&&('Nº '+number),neighborhood,complement].filter(Boolean).join(', ');
      }else customer.address='Retirada na loja';
      const order={...b,customer,id:Date.now(),day:today,number:count,status:'Novo',createdAt:new Date().toISOString(),subtotal,deliveryFee,total:subtotal+deliveryFee};
      d.orders.push(order);write(d);return send(res,201,order);
    }

    if(!auth(req)) return send(res,401,{error:'Não autorizado'});

    if(req.method==='GET'&&pathname==='/api/admin'){ const d=read(); return send(res,200,d); }
    if(req.method==='PUT'&&pathname==='/api/settings'){
      const b=await body(req),d=read();if(b.adminPassword!==undefined&&String(b.adminPassword).trim()==='') delete b.adminPassword; d.settings={...d.settings,...b}; write(d); return send(res,200,{ok:true});
    }
    if(req.method==='GET'&&pathname==='/api/orders')return send(res,200,read().orders.slice().reverse());
    const om=pathname.match(/^\/api\/orders\/(\d+)$/);
    if(om&&req.method==='PUT'){const b=await body(req),d=read(),o=d.orders.find(x=>String(x.id)===om[1]);if(!o)return send(res,404,{error:'Pedido não encontrado'});o.status=b.status||o.status;write(d);return send(res,200,o);}

    if(req.method==='GET'&&pathname==='/api/categories') return send(res,200,read().categories||[]);
    if(req.method==='POST'&&pathname==='/api/categories'){
      const b=await body(req),d=read(); const name=String(b.name||'').trim();
      if(!name)return send(res,400,{error:'Informe o nome da categoria'});
      if((d.categories||[]).some(c=>normalizeDeliveryText(c)===normalizeDeliveryText(name)))return send(res,409,{error:'Categoria já existe'});
      d.categories.push(name); write(d); return send(res,201,{name});
    }
    const cm=pathname.match(/^\/api\/categories\/(\d+)$/);
    if(cm&&req.method==='PUT'){
      const b=await body(req),d=read(),idx=Number(cm[1]),old=d.categories[idx],name=String(b.name||'').trim();
      if(old===undefined)return send(res,404,{error:'Categoria não encontrada'});
      if(!name)return send(res,400,{error:'Informe o nome da categoria'});
      if(d.categories.some((c,i)=>i!==idx&&normalizeDeliveryText(c)===normalizeDeliveryText(name)))return send(res,409,{error:'Categoria já existe'});
      d.categories[idx]=name; d.products.forEach(p=>{if(normalizeDeliveryText(p.cat)===normalizeDeliveryText(old))p.cat=name}); write(d); return send(res,200,{name});
    }
    if(cm&&req.method==='DELETE'){
      const d=read(),idx=Number(cm[1]),name=d.categories[idx];
      if(name===undefined)return send(res,404,{error:'Categoria não encontrada'});
      const used=d.products.some(p=>normalizeDeliveryText(p.cat)===normalizeDeliveryText(name)&&p.active!==false);
      if(used)return send(res,409,{error:'Não é possível excluir: existem produtos ativos nesta categoria. Edite ou mova os produtos primeiro.'});
      d.categories.splice(idx,1); write(d); return send(res,200,{ok:true});
    }

    if(req.method==='POST'&&pathname==='/api/products'){
      const b=await body(req),d=read();const p={id:Date.now(),active:true,emoji:'🍔',image:'',desc:'',...b,price:Number(b.price)||0};d.products.push(p);write(d);return send(res,201,p);
    }
    const pm=pathname.match(/^\/api\/products\/(\d+)$/);
    if(pm&&req.method==='PUT'){const b=await body(req),d=read(),i=d.products.findIndex(x=>String(x.id)===pm[1]);if(i<0)return send(res,404,{error:'Produto não encontrado'});d.products[i]={...d.products[i],...b,price:Number(b.price)||0};write(d);return send(res,200,d.products[i]);}
    if(pm&&req.method==='DELETE'){const d=read(),p=d.products.find(x=>x.id==pm[1]);if(p)p.active=false;write(d);return send(res,200,{ok:true});}

    if(req.method==='POST'&&pathname==='/api/delivery-zones'){
      const b=await body(req),d=read();const z={id:Date.now(),neighborhood:String(b.neighborhood||'').trim(),street:String(b.street||'').trim(),fee:Number(b.fee)||0,active:b.active!==false};
      if(!z.neighborhood)return send(res,400,{error:'Informe o bairro'});
      d.deliveryZones.push(z);write(d);return send(res,201,z);
    }
    const zm=pathname.match(/^\/api\/delivery-zones\/(\d+)$/);
    if(zm&&req.method==='PUT'){const b=await body(req),d=read(),i=d.deliveryZones.findIndex(x=>String(x.id)===zm[1]);if(i<0)return send(res,404,{error:'Taxa não encontrada'});d.deliveryZones[i]={...d.deliveryZones[i],...b,fee:Number(b.fee)||0};write(d);return send(res,200,d.deliveryZones[i]);}
    if(zm&&req.method==='DELETE'){const d=read();d.deliveryZones=d.deliveryZones.filter(x=>String(x.id)!==zm[1]);write(d);return send(res,200,{ok:true});}

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

// CHEFE TELLES V5 CONFIG
const __v5fs=require('fs'),__v5path=require('path'),__v5file=__v5path.join(__dirname,'data.json');
app.get('/api/config-v5',(req,res)=>{try{let d=JSON.parse(__v5fs.readFileSync(__v5file,'utf8'));res.json(d.configuracoes||{})}catch(e){res.json({})}});
app.post('/api/config-v5',(req,res)=>{try{let d=JSON.parse(__v5fs.readFileSync(__v5file,'utf8'));d.configuracoes=d.configuracoes||{};Object.assign(d.configuracoes,req.body||{});__v5fs.writeFileSync(__v5file,JSON.stringify(d,null,2));res.json({ok:true})}catch(e){res.status(500).json({ok:false})}});
  server.listen(port,'0.0.0.0',()=>console.log(`\nCHEFE TELLES v2.0 — servidor online\nLoja:   http://localhost:${port}/\nDono:   http://localhost:${port}/admin\nThermer: http://localhost:${port}/thermer-test.html\n`));
}
listenOnAvailablePort(server, PORT);
