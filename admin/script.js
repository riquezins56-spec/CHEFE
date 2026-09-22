let API_BASE = window.CHEFE_API_BASE || (location.protocol==='file:' ? '' : location.origin);
let token=localStorage.getItem('chefeAdminToken')||'',state={};const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
async function discoverBase(){for(const p of [3000,3001,3002,3003,3004,3005,3006,3007,3008,3009,3010]){try{const r=await fetch('http://127.0.0.1:'+p+'/api/health',{cache:'no-store'});if(r.ok){const h=await r.json();if(h.ok&&h.store==='CHEFE TELLES'&&h.version==='2.0.0'){API_BASE='http://127.0.0.1:'+p;localStorage.setItem('chefeApiBase',API_BASE);return API_BASE}}}catch(e){}}throw Error('Não foi possível conectar ao servidor. Execute o INICIAR.bat.');}
async function api(path,opt={}){opt.headers={...(opt.headers||{}),...(token?{Authorization:'Bearer '+token}:{})};try{const r=await fetch(API_BASE+path,opt);let d={};try{d=await r.json()}catch{}if(r.status===401){token='';localStorage.removeItem('chefeAdminToken');showLogin();throw Error('Não autorizado')}if(!r.ok)throw Error(d.error||'Erro no servidor');return d}catch(first){if(location.protocol==='file:' || !API_BASE){API_BASE=await discoverBase();const r=await fetch(API_BASE+path,opt);let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.error||'Erro no servidor');return d}throw first}}
function showLogin(){$('#login').classList.remove('hidden');$('#app').classList.add('hidden')}function showApp(){$('#login').classList.add('hidden');$('#app').classList.remove('hidden')}
$('#loginForm').onsubmit=async e=>{e.preventDefault();$('#loginError').textContent='';try{const d=await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#password').value})});token=d.token;localStorage.setItem('chefeAdminToken',token);$('#password').value='';showApp();await refreshAll()}catch(err){$('#loginError').textContent=err.message}};
$('#viewStore').onclick=e=>{if(location.protocol==='file:'){e.preventDefault();discoverBase().then(base=>window.open(base+'/','_blank')).catch(()=>{})}};$('#logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}catch{}token='';localStorage.removeItem('chefeAdminToken');showLogin()};
function openTab(id){$$('.tab').forEach(x=>x.classList.toggle('active',x.id===id));$$('.nav').forEach(x=>x.classList.toggle('active',x.dataset.tab===id));if(id==='orders')loadOrders();if(id==='products')loadProducts();if(id==='categories')loadCategories();if(id==='delivery')renderV9()}
$$('.nav').forEach(b=>b.onclick=()=>openTab(b.dataset.tab));$$('[data-go]').forEach(b=>b.onclick=()=>openTab(b.dataset.go));$('#refresh').onclick=refreshAll;$('#refreshOrders').onclick=loadOrders;
async function refreshAll(){state=await api('/api/admin');renderDashboard();renderSettings();await loadOrders();await loadCategories();await loadProducts();renderV9();$('#serverAddress').textContent=location.origin+'/'; await loadNetworkLinks();}

async function loadNetworkLinks(){const box=$('#serverLinks');if(!box)return;try{const d=await api('/api/network');const port=location.port||'3000';const ips=d.ips||[];box.innerHTML=ips.length?ips.map(ip=>`<div><span>ACESSO PELO CELULAR</span><b>http://${ip}:${port}/</b><br><small>PAINEL: http://${ip}:${port}/admin</small></div>`).join(''):'<div><span>REDE</span><b>IP não detectado</b></div>';}catch{box.innerHTML='<div><span>REDE</span><b>Execute o servidor pelo INICIAR.bat.</b></div>';}}

function renderDashboard(){
 const now=new Date(),today=now.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),month=today.slice(0,7),all=state.orders||[];
 const os=all.filter(o=>o.day===today),ms=all.filter(o=>String(o.day||'').slice(0,7)===month);
 $('#statOrders').textContent=os.length;
 $('#statRevenue').textContent=money(os.reduce((sum,o)=>sum+Number(o.total||0),0));
 $('#statMonthOrders').textContent=ms.length;
 $('#statMonthRevenue').textContent=money(ms.reduce((sum,o)=>sum+Number(o.total||0),0));
 $('#statNew').textContent=os.filter(o=>o.status==='Novo').length;
 $('#statProducts').textContent=(state.products||[]).filter(p=>p.active!==false).length;
}
async function loadOrders(){try{const os=await api('/api/orders');state.orders=os;renderDashboard();$('#ordersList').innerHTML=os.length?os.map(o=>`<article class="order"><div><h3>NOVO PEDIDO ${String(o.number).padStart(2,'0')}</h3><p><b>${esc(o.customer?.name||'Cliente')}</b> · ${esc(o.customer?.phone||'')}</p><p>${o.customer?.delivery==='Retirada'?'Retirada na loja':'Entrega · '+esc(o.customer?.address||'')}</p><p>${(o.items||[]).map(i=>`${i.qty}x ${esc(i.name)}`).join(' · ')}</p><p class="total">${money(o.total)} <span class="tag">${esc(o.customer?.payment||'')}</span></p></div><div class="order-actions"><select data-status="${o.id}">${['Novo','Em preparo','Pronto','Saiu para entrega','Entregue','Cancelado'].map(s=>`<option ${o.status===s?'selected':''}>${s}</option>`).join('')}</select><button class="btn" data-print="${o.id}">Imprimir</button><button class="btn" data-order-del="${o.id}">Excluir</button></div></article>`).join(''):'<div class="panel">Nenhum pedido ainda.</div>';$$('[data-status]').forEach(s=>s.onchange=async()=>{await api('/api/orders/'+s.dataset.status,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s.value})});await loadOrders()});$$('[data-print]').forEach(b=>b.onclick=()=>printOrder(b.dataset.print));
$$('[data-order-del]').forEach(b=>b.onclick=async()=>{
 if(confirm('Excluir este pedido definitivamente? Somente o dono pode fazer isso.')){
   await api('/api/orders/'+b.dataset.orderDel,{method:'DELETE'});
   const ids=autoPrintedIds();ids.delete(String(b.dataset.orderDel));saveAutoPrinted(ids);
   await refreshAll();
 }
})}catch(err){if(token)$('#ordersList').innerHTML='<div class="panel error">'+esc(err.message)+'</div>'}}
function printOrder(id){
  const u=location.origin+'/print/'+id;
  const ua=navigator.userAgent.toLowerCase();

  // Mantém o Painel do Dono aberto. O protocolo é disparado fora da navegação da aba.
  function abrirAppImpressao(protocolo){
    let frame=document.getElementById('chefeSilentPrintFrame');
    if(!frame){
      frame=document.createElement('iframe');
      frame.id='chefeSilentPrintFrame';
      frame.name='chefeSilentPrintFrame';
      frame.setAttribute('aria-hidden','true');
      frame.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-9999px;top:-9999px';
      document.body.appendChild(frame);
    }
    frame.src='about:blank';
    setTimeout(()=>{ frame.src=protocolo+u; },30);
  }

  if(/android/.test(ua)){
    // Android: envia o pedido direto ao Thermer/Bluetooth Print sem trocar a página do painel.
    abrirAppImpressao('my.bluetoothprint.scheme://');
  }else if(/iphone|ipad|ipod/.test(ua)){
    // iPhone: mantém o fluxo BPrint sem trocar a página do painel.
    abrirAppImpressao('bprint://');
  }else{
    // PC: mantém o método já existente em janela separada.
    window.open('/thermer-test.html?order='+encodeURIComponent(id),'chefePrint','width=520,height=720');
  }
}

// Impressão automática: monitora pedidos novos e dispara uma única vez por pedido.
const AUTO_PRINT_KEY='chefeAutoPrintedOrdersV1';
let autoPrintReady=false,autoPrintBusy=false;
function autoPrintedIds(){try{return new Set(JSON.parse(localStorage.getItem(AUTO_PRINT_KEY)||'[]').map(String))}catch{return new Set()}}
function saveAutoPrinted(ids){localStorage.setItem(AUTO_PRINT_KEY,JSON.stringify([...ids].slice(-300)))}
async function autoPrintNewOrders(){
  if(!token||autoPrintBusy||document.hidden)return;
  autoPrintBusy=true;
  try{
    const os=await api('/api/orders'), ids=autoPrintedIds();
    if(!autoPrintReady){os.forEach(o=>ids.add(String(o.id)));saveAutoPrinted(ids);autoPrintReady=true;return}
    const novos=os.filter(o=>o.status==='Novo'&&!ids.has(String(o.id))).reverse();
    for(const o of novos){
      ids.add(String(o.id));saveAutoPrinted(ids);
      printOrder(o.id);
      await new Promise(r=>setTimeout(r,1800));
    }
    if(novos.length){state.orders=os;renderDashboard();}
  }catch(e){}finally{autoPrintBusy=false}
}
setInterval(autoPrintNewOrders,5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){autoPrintNewOrders();if(token)loadOrders().catch(()=>{})}});
window.addEventListener('pageshow',()=>{if(token){showApp();loadOrders().catch(()=>{})}});
function fillCategorySelect(selected=''){const sel=$('#pCat');sel.innerHTML=(state.categories||[]).map(c=>`<option ${c===selected?'selected':''}>${esc(c)}</option>`).join('')}
function adminFoodIcon(cat=''){const c=String(cat).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(c.includes('pizza'))return '<span class="admin-icon">◉</span>';if(c.includes('bebida'))return '<span class="admin-icon">▱</span>';if(c.includes('acai'))return '<span class="admin-icon">◍</span>';if(c.includes('combo'))return '<span class="admin-icon">▣</span>';return '<span class="admin-icon">◆</span>';}
async function loadProducts(){state=state.categories?state:await api('/api/admin');fillCategorySelect($('#pCat').value);const ps=state.products||[];$('#productsList').innerHTML=ps.map(p=>`<article><div>${p.image?`<img src="${esc(p.image)}" alt="">`:`<div class="thumb">${adminFoodIcon(p.cat)}</div>`}</div><div><h3>${esc(p.name)} <span class="tag">${esc(p.cat)}</span></h3><p>${esc(p.desc||'')}</p><strong>${money(p.price)}</strong></div><div class="actions"><button class="btn" data-edit="${p.id}">Editar</button><button class="btn" data-del="${p.id}">Excluir</button></div></article>`).join('');$$('[data-edit]').forEach(b=>b.onclick=()=>editProduct(b.dataset.edit));$$('[data-del]').forEach(b=>b.onclick=async()=>{if(confirm('Excluir este produto do cardápio?')){await api('/api/products/'+b.dataset.del,{method:'DELETE'});await refreshAll()}})}
let imageData='';function resetProduct(){imageData='';$('#productForm').reset();fillCategorySelect((state.categories||[])[0]||'');$('#productId').value='';$('#pPreview').style.display='none';$('#productFormTitle').textContent='Novo produto';$('#productFormPanel').classList.remove('hidden')}
$('#newProduct').onclick=resetProduct;$('#cancelProduct').onclick=()=>$('#productFormPanel').classList.add('hidden');$('#pImage').onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>1800000){alert('Use uma imagem de até 1,8 MB.');e.target.value='';return}const rd=new FileReader();rd.onload=()=>{imageData=rd.result;$('#pPreview').src=imageData;$('#pPreview').style.display='block'};rd.readAsDataURL(f)};
async function editProduct(id){const p=(state.products||[]).find(x=>String(x.id)===String(id));if(!p)return;fillCategorySelect(p.cat);$('#productFormPanel').classList.remove('hidden');$('#productFormTitle').textContent='Editar produto';$('#productId').value=p.id;$('#pName').value=p.name;$('#pPrice').value=p.price;$('#pDesc').value=p.desc||'';imageData=p.image||'';if(imageData){$('#pPreview').src=imageData;$('#pPreview').style.display='block'}else $('#pPreview').style.display='none'}
$('#productForm').onsubmit=async e=>{e.preventDefault();const id=$('#productId').value,payload={name:$('#pName').value.trim(),cat:$('#pCat').value,price:Number($('#pPrice').value),desc:$('#pDesc').value.trim(),image:imageData};await api(id?'/api/products/'+id:'/api/products',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});$('#productFormPanel').classList.add('hidden');await refreshAll()};
async function loadCategories(){state=state.categories?state:await api('/api/admin');const cats=state.categories||[];$('#categoriesList').innerHTML=cats.map((c,i)=>`<article class="category-admin-item"><div><strong>${esc(c)}</strong><small>${(state.products||[]).filter(p=>p.cat===c&&p.active!==false).length} produto(s) ativo(s)</small></div><div class="actions"><button class="btn" data-cat-edit="${i}">Editar</button><button class="btn" data-cat-del="${i}">Excluir</button></div></article>`).join('')||'<div class="panel">Nenhuma categoria cadastrada.</div>';$$('[data-cat-edit]').forEach(b=>b.onclick=()=>editCategory(Number(b.dataset.catEdit)));$$('[data-cat-del]').forEach(b=>b.onclick=async()=>{try{await api('/api/categories/'+b.dataset.catDel,{method:'DELETE'});await refreshAll()}catch(e){alert(e.message)}});fillCategorySelect($('#pCat').value)}
function resetCategory(){$('#categoryForm').reset();$('#categoryId').value='';$('#categoryFormPanel').classList.remove('hidden');$('#categoryName').focus()}function editCategory(i){$('#categoryId').value=i;$('#categoryName').value=state.categories[i]||'';$('#categoryFormPanel').classList.remove('hidden');$('#categoryName').focus()}
$('#newCategory').onclick=resetCategory;$('#cancelCategory').onclick=()=>$('#categoryFormPanel').classList.add('hidden');$('#categoryForm').onsubmit=async e=>{e.preventDefault();const id=$('#categoryId').value,name=$('#categoryName').value.trim();await api(id===''?'/api/categories':'/api/categories/'+id,{method:id===''?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});$('#categoryFormPanel').classList.add('hidden');await refreshAll()};
function renderSettings(){const s=state.settings||{};$('#sName').value=s.name||'';$('#sWhatsapp').value=s.whatsapp||'';$('#sPixKey').value=s.pixKey||'';$('#sPixRecipient').value=s.pixRecipient||'';$('#sPixType').value=s.pixType||'';$('#sPixQr').value=s.pixQr||'';if(s.pixQr){$('#sPixPreview').src=s.pixQr;$('#sPixPreview').style.display='block'}else $('#sPixPreview').style.display='none';$('#sBotWhatsapp').value=s.botWhatsapp||s.whatsapp||'';$('#sBotMessage').value=s.botMessage||'👋 Olá! Bem-vindo ao CHEFE TELLES FAST FOOD!'}$('#settingsForm').onsubmit=async e=>{e.preventDefault();const payload={name:$('#sName').value.trim(),whatsapp:$('#sWhatsapp').value.trim()};if($('#sPassword').value)payload.adminPassword=$('#sPassword').value;await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});$('#sPassword').value='';$('#settingsMsg').textContent='Configurações salvas.';setTimeout(()=>$('#settingsMsg').textContent='',2500)};
if(token){showApp();refreshAll().catch(()=>showLogin())}else showLogin();

$('#sPixQrFile').onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>1800000){alert('Use uma imagem de até 1,8 MB.');e.target.value='';return}const rd=new FileReader();rd.onload=()=>{$('#sPixQr').value=rd.result;$('#sPixPreview').src=rd.result;$('#sPixPreview').style.display='block'};rd.readAsDataURL(f)};
$('#pixForm').onsubmit=async e=>{e.preventDefault();const payload={pixKey:$('#sPixKey').value.trim(),pixRecipient:$('#sPixRecipient').value.trim(),pixType:$('#sPixType').value,pixQr:$('#sPixQr').value};await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});state.settings={...state.settings,...payload};$('#pixMsg').textContent='PIX salvo.';setTimeout(()=>$('#pixMsg').textContent='',2500)};
$('#botForm').onsubmit=async e=>{e.preventDefault();const payload={botWhatsapp:$('#sBotWhatsapp').value.replace(/\D/g,''),botMessage:$('#sBotMessage').value};await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});state.settings={...state.settings,...payload};$('#botMsg').textContent='Bot salvo. Abrindo teste no WhatsApp.';const msg=encodeURIComponent('🤖 TESTE DO BOT CHEFE TELLES\n\n'+payload.botMessage);if(payload.botWhatsapp)window.open('https://wa.me/'+payload.botWhatsapp+'?text='+msg,'_blank');setTimeout(()=>$('#botMsg').textContent='',3000)};

// V9: entregadores, faixas por KM, GPS e tempo estimado
async function renderV9(){
 const d=state||{};
 const kl=$('#kmList'); if(kl) kl.innerHTML=(d.deliveryKmRanges||[]).sort((a,b)=>a.maxKm-b.maxKm).map(x=>`<article class="zone"><div><h3>Até ${Number(x.maxKm).toFixed(1)} km</h3><span class="tag">${money(x.fee)}</span></div><button class="btn" data-km-del="${x.id}">Excluir</button></article>`).join('')||'<p>Nenhuma faixa por km cadastrada.</p>';
 $$('[data-km-del]').forEach(b=>b.onclick=async()=>{await api('/api/delivery-km/'+b.dataset.kmDel,{method:'DELETE'});await refreshAll();renderV9()});
 const dl=$('#driversList'); if(dl) dl.innerHTML=(d.drivers||[]).map(x=>`<article class="zone"><div><h3>${esc(x.name)}</h3><p>${esc(x.phone||'')}</p></div><button class="btn" data-driver-del="${x.id}">Excluir</button></article>`).join('')||'<div class="panel">Nenhum entregador cadastrado.</div>';
 $$('[data-driver-del]').forEach(b=>b.onclick=async()=>{await api('/api/drivers/'+b.dataset.driverDel,{method:'DELETE'});await refreshAll();renderV9()});
 const s=d.settings||{}; if($('#sStoreLat')){$('#sStoreLat').value=s.storeLat||'';$('#sStoreLng').value=s.storeLng||'';$('#sEta').value=s.defaultEtaMinutes||'';}
 if($('#extraKmFee'))$('#extraKmFee').value=Number(s.extraKmFee)||0;
 if($('#maxDeliveryKm'))$('#maxDeliveryKm').value=Number(s.maxDeliveryKm)||0;
}
$('#kmForm')?.addEventListener('submit',async e=>{e.preventDefault();await api('/api/delivery-km',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxKm:Number($('#kmMax').value),fee:Number($('#kmFee').value)})});e.target.reset();await refreshAll();renderV9()});
$('#driverForm')?.addEventListener('submit',async e=>{e.preventDefault();await api('/api/drivers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#driverName').value,phone:$('#driverPhone').value})});e.target.reset();await refreshAll();renderV9()});
const oldRenderSettings=renderSettings;renderSettings=function(){oldRenderSettings();renderV9()};
const oldSettingsSubmit=$('#settingsForm').onsubmit;$('#settingsForm').onsubmit=async e=>{e.preventDefault();const payload={name:$('#sName').value.trim(),whatsapp:$('#sWhatsapp').value.trim(),deliveryMode:'route',storeLat:$('#sStoreLat').value.trim(),storeLng:$('#sStoreLng').value.trim(),storeCep:$('#sStoreCep').value.trim(),storeStreet:$('#sStoreStreet').value.trim(),storeNumber:$('#sStoreNumber').value.trim(),storeNeighborhood:$('#sStoreNeighborhood').value.trim(),storeCity:$('#sStoreCity').value.trim(),storeState:$('#sStoreState').value.trim().toUpperCase(),defaultEtaMinutes:Number($('#sEta').value)||0};if($('#sPassword').value)payload.adminPassword=$('#sPassword').value;await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});$('#sPassword').value='';$('#settingsMsg').textContent='Configurações salvas.';state.settings={...state.settings,...payload};setTimeout(()=>$('#settingsMsg').textContent='',2500)};
setTimeout(()=>renderV9(),300);

// V9.3: cadastro amigável da localização da loja por CEP/endereço ou GPS
function fillStoreAddress(s={}){ if($('#sStoreCep')){$('#sStoreCep').value=s.storeCep||'';$('#sStoreStreet').value=s.storeStreet||'';$('#sStoreNumber').value=s.storeNumber||'';$('#sStoreNeighborhood').value=s.storeNeighborhood||'';$('#sStoreCity').value=s.storeCity||'';$('#sStoreState').value=s.storeState||'';} }
async function lookupStoreCep(){const cep=$('#sStoreCep').value.replace(/\D/g,'');if(cep.length!==8)throw Error('Informe um CEP com 8 números.');const r=await fetch('https://viacep.com.br/ws/'+cep+'/json/');const j=await r.json();if(!r.ok||j.erro)throw Error('CEP não encontrado.');$('#sStoreStreet').value=j.logradouro||'';$('#sStoreNeighborhood').value=j.bairro||'';$('#sStoreCity').value=j.localidade||'';$('#sStoreState').value=j.uf||'';return j;}
$('#findStoreCep')?.addEventListener('click',async()=>{const m=$('#storeLocationMsg');try{m.textContent='Buscando CEP...';await lookupStoreCep();m.textContent='CEP encontrado. Confira o endereço e informe o número.';}catch(e){m.textContent=e.message}});
$('#useStoreGps')?.addEventListener('click',()=>{const m=$('#storeLocationMsg');if(!navigator.geolocation){m.textContent='GPS não disponível neste aparelho.';return}m.textContent='Obtendo localização e endereço...';navigator.geolocation.getCurrentPosition(async p=>{const lat=p.coords.latitude,lng=p.coords.longitude;$('#sStoreLat').value=lat;$('#sStoreLng').value=lng;try{const r=await api('/api/store-location/reverse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat,lng})});if(r.cep)$('#sStoreCep').value=r.cep;if(r.street)$('#sStoreStreet').value=r.street;if(r.number)$('#sStoreNumber').value=r.number;if(r.neighborhood)$('#sStoreNeighborhood').value=r.neighborhood;if(r.city)$('#sStoreCity').value=r.city;if(r.state)$('#sStoreState').value=String(r.state).replace(/^BR-/,'').slice(0,2).toUpperCase();m.textContent='Localização encontrada e endereço preenchido. Confira principalmente o número e clique em Salvar configurações.';}catch(e){m.textContent='GPS capturado. Não conseguimos preencher todo o endereço, mas a localização exata foi mantida. Complete os campos e salve.';}},e=>m.textContent='Não foi possível obter a localização. Autorize o acesso ao GPS.',{enableHighAccuracy:true,timeout:20000,maximumAge:0})});
$('#confirmStoreLocation')?.addEventListener('click',async()=>{const m=$('#storeLocationMsg');try{m.textContent='Localizando endereço da loja...';const payload={cep:$('#sStoreCep').value,street:$('#sStoreStreet').value,number:$('#sStoreNumber').value,neighborhood:$('#sStoreNeighborhood').value,city:$('#sStoreCity').value,state:$('#sStoreState').value};const r=await api('/api/store-location/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});$('#sStoreLat').value=r.lat;$('#sStoreLng').value=r.lng;const savePayload={deliveryMode:'route',storeLat:String(r.lat),storeLng:String(r.lng),storeCep:$('#sStoreCep').value.trim(),storeStreet:$('#sStoreStreet').value.trim(),storeNumber:$('#sStoreNumber').value.trim(),storeNeighborhood:$('#sStoreNeighborhood').value.trim(),storeCity:$('#sStoreCity').value.trim(),storeState:$('#sStoreState').value.trim().toUpperCase()};await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(savePayload)});state.settings={...state.settings,...savePayload};m.textContent='Localização da loja confirmada e salva. O cálculo por km já pode ser usado.';}catch(e){m.textContent='O mapa não encontrou esse endereço exato. Você ainda pode salvar o endereço. Para cálculo por km, use “Usar localização atual” para registrar o ponto exato da loja.';}});
const _renderV93=renderV9;renderV9=function(){_renderV93();fillStoreAddress((state||{}).settings||{})};

// V9.8 — sistema único de entrega por rota
$('#saveDeliveryRules')?.addEventListener('click',async()=>{
 const payload={deliveryMode:'route',extraKmFee:Number($('#extraKmFee').value)||0,maxDeliveryKm:Number($('#maxDeliveryKm').value)||0};
 await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 state.settings={...state.settings,...payload}; $('#deliveryRulesMsg').textContent='Regras de entrega salvas.';
 setTimeout(()=>$('#deliveryRulesMsg').textContent='',2500);
});
