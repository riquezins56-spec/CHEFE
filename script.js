let products=[],cart=[],store={categories:[],settings:{},deliveryZones:[],deliveryKmRanges:[]};
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
async function loadStore(){try{const r=await fetch('/api/store',{cache:'no-store'});if(!r.ok)throw Error();store=await r.json();products=store.products||[];renderCategories();renderProducts();setupDelivery();}catch(e){document.querySelector('#products').innerHTML='<p class="error">Inicie o servidor pelo INICIAR.bat.</p>';}}
function renderCategories(){const cats=store.categories?.length?store.categories:[...new Set(products.map(p=>p.cat).filter(Boolean))];document.querySelector('#categories').innerHTML=cats.map(c=>`<a class="cat" href="#cat-${slug(c)}">${esc(c)}</a>`).join('');}
function slug(s){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');}
function renderProducts(){const cats=store.categories?.length?store.categories:[...new Set(products.map(p=>p.cat).filter(Boolean))];document.querySelector('#products').innerHTML=cats.map(cat=>{const list=products.filter(p=>p.cat===cat);if(!list.length)return '';return `<section class="category-section" id="cat-${slug(cat)}"><div class="category-title"><span class="eyebrow">CARDÁPIO</span><h3>${esc(cat)}</h3><span class="category-line"></span></div><div class="products">${list.map(productCard).join('')}</div></section>`}).join('')||'<p class="error">Nenhum produto disponível.</p>';}
function foodIcon(cat=''){const c=normalizeText(cat);if(c.includes('pizza'))return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 10c18 3 34 13 48 30L44 55 8 10Z" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="27" cy="25" r="4" fill="currentColor"/><circle cx="38" cy="34" r="4" fill="currentColor"/></svg>';if(c.includes('bebida'))return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M19 9h26l-3 47H22L19 9Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M20 18h25" stroke="currentColor" stroke-width="3"/><path d="M39 9c2-5 7-6 8-3" fill="none" stroke="currentColor" stroke-width="3"/></svg>';if(c.includes('aça')||c.includes('acai'))return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 12h28l-3 44H21l-3-44Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M18 21h28M23 29h18" stroke="currentColor" stroke-width="3"/></svg>';if(c.includes('combo'))return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 25h40v27H12z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M18 25V14h28v11M20 38h24" fill="none" stroke="currentColor" stroke-width="3"/></svg>';return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 27h44l-4 18H14l-4-18Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M14 21c6-9 30-9 36 0M15 33h34M20 45h24" fill="none" stroke="currentColor" stroke-width="3"/></svg>';}
function productCard(p){return `<article class="product"><div class="food-img">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}">`:`<div class="food-placeholder">${foodIcon(p.cat)}</div>`}<span class="ember-dot"></span></div><div class="product-body"><span class="product-cat">${esc(p.cat||'Especial')}</span><h3>${esc(p.name)}</h3><p>${esc(p.desc||'')}</p><div class="price-row"><span class="price">${money(p.price)}</span><button class="add" onclick="add(${p.id})">+ Adicionar</button></div></div></article>`;}
function add(id){const p=products.find(x=>x.id===id);if(!p)return;const x=cart.find(i=>i.id===id);x?x.qty++:cart.push({...p,qty:1});renderCart();openCart();}
function change(id,d){const x=cart.find(i=>i.id===id);if(!x)return;x.qty+=d;if(x.qty<=0)cart=cart.filter(i=>i.id!==id);renderCart();}
function renderCart(){document.querySelector('#cartCount').textContent=cart.reduce((s,i)=>s+i.qty,0);document.querySelector('#cartItems').innerHTML=cart.length?cart.map(i=>`<div class="cart-item"><div class="cart-item-top"><strong>${i.qty}x ${esc(i.name)}</strong><span>${money(i.price*i.qty)}</span></div><div class="qty"><button onclick="change(${i.id},-1)">−</button><span>${i.qty}</span><button onclick="change(${i.id},1)">+</button></div></div>`).join(''):'<p class="empty">Seu carrinho está vazio.</p>';document.querySelector('#subtotal').textContent=money(cart.reduce((s,i)=>s+i.price*i.qty,0));}
function openCart(){document.querySelector('#cart').classList.add('open');document.querySelector('#overlay').classList.add('show')}function closeCart(){document.querySelector('#cart').classList.remove('open');document.querySelector('#overlay').classList.remove('show')}
document.querySelector('#cartBtn').onclick=openCart;document.querySelector('#clearCart').onclick=()=>{cart=[];renderCart();closeCart();};document.querySelector('#closeCart').onclick=closeCart;document.querySelector('#overlay').onclick=closeCart;document.querySelector('#checkoutBtn').onclick=()=>{if(!cart.length)return alert('Adicione pelo menos um produto.');document.querySelector('#checkoutModal').classList.add('show');closeCart()};document.querySelector('#closeModal').onclick=()=>document.querySelector('#checkoutModal').classList.remove('show');
let deliveryZones=[];const normalizeText=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();function findDeliveryZone(neighborhood,street){const nb=normalizeText(neighborhood),st=normalizeText(street);if(!nb)return null;const same=deliveryZones.filter(z=>z.active!==false&&normalizeText(z.neighborhood)===nb);if(!same.length)return null;const exact=same.find(z=>st&&normalizeText(z.street)===st);return exact||same.find(z=>!normalizeText(z.street))||null;}
function setupDelivery(){deliveryZones=store.deliveryZones||[];const type=document.querySelector('#deliveryType'),bairro=document.querySelector('#neighborhood'),rua=document.querySelector('#street'),fee=document.querySelector('#deliveryFee'),feePreview=document.querySelector('#deliveryFeePreview'),fields=document.querySelector('#deliveryFields'),addr=document.querySelector('#address'),addrLabel=document.querySelector('#addressLabel'),hint=document.querySelector('#deliveryHint'),nbList=document.querySelector('#neighborhoodList'),streetList=document.querySelector('#streetList');if(!type||!bairro)return;nbList.innerHTML=[...new Set(deliveryZones.map(z=>z.neighborhood).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(x=>`<option value="${esc(x)}">`).join('');function refreshStreetSuggestions(){const nb=normalizeText(bairro.value);streetList.innerHTML=[...new Set(deliveryZones.filter(z=>z.active!==false&&normalizeText(z.neighborhood)===nb&&normalizeText(z.street)).map(z=>z.street))].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(x=>`<option value="${esc(x)}">`).join('');}function buildAddress(){if(type.value==='Retirada'){addr.value='Retirada na loja';return;}const street=rua.value.trim(),num=document.querySelector('[name=number]').value.trim(),comp=document.querySelector('[name=complement]').value.trim(),ref=(document.querySelector('[name=reference]')?.value||'').trim();addr.value=[street,num&&('Nº '+num),bairro.value.trim(),comp,ref&&('Referência: '+ref)].filter(Boolean).join(', ');}function update(){const retirada=type.value==='Retirada';syncOrderTypeUI();fields.style.display=retirada?'none':'block';addrLabel.style.display=retirada?'none':'block';addr.required=!retirada;bairro.required=!retirada;rua.required=!retirada;document.querySelector('[name=number]').required=!retirada;
const cepEl=document.querySelector('#cep'),compEl=document.querySelector('[name=complement]'),refEl=document.querySelector('[name=reference]');
for(const el of [cepEl,bairro,rua,document.querySelector('[name=number]'),compEl,refEl]){if(el)el.disabled=retirada;}if(retirada){
  fee.disabled=false;fee.value='0';feePreview.textContent=money(0);hint.textContent='Retirada na loja: sem taxa de entrega.';addr.value='Retirada na loja';
  document.querySelector('#customerLat').value='';document.querySelector('#customerLng').value='';
  const submitBtn=document.querySelector('#orderForm button[type=submit]');if(submitBtn){submitBtn.disabled=false;submitBtn.style.display='block';submitBtn.textContent='CONFIRMAR PEDIDO';}
  const mapWrap=document.querySelector('#deliveryMapWrap'),searchArea=document.querySelector('#addressSearchArea'),rs=document.querySelector('#routeSummary');
  if(mapWrap)mapWrap.classList.remove('show');if(searchArea)searchArea.classList.remove('show');if(rs)rs.style.display='none';
  return;
}refreshStreetSuggestions();if(true){if(!document.querySelector('#customerLat')?.value){fee.value='0';feePreview.textContent='Aguardando endereço';hint.textContent='Informe CEP, rua e número. A rota e a taxa por km serão calculadas automaticamente.';}buildAddress();return;}const zone=findDeliveryZone(bairro.value,rua.value);if(zone){const v=Number(zone.fee)||0;fee.value=String(v);feePreview.textContent=money(v);hint.textContent=normalizeText(zone.street)?`Taxa aplicada para ${zone.street}.`:`Taxa fixa do bairro ${zone.neighborhood}.`;}else{fee.value='0';feePreview.textContent='Não cadastrada';hint.textContent='A taxa aparece automaticamente quando o bairro/rua estiver cadastrado pela loja.';}buildAddress();}type.onchange=update;bairro.oninput=update;bairro.onchange=update;rua.oninput=update;rua.onchange=update;document.querySelector('[name=number]').oninput=buildAddress;document.querySelector('[name=complement]').oninput=buildAddress;update();}

function syncOrderTypeUI(){
  const retirada=document.querySelector('#deliveryType')?.value==='Retirada';
  const pickup=document.querySelector('#pickupFields'),delivery=document.querySelector('#deliveryFields');
  const address=document.querySelector('#addressLabel'),pay=document.querySelector('#paymentLabel');
  const note=document.querySelector('#noteLabel'),confirm=document.querySelector('#confirmDelivery');
  const sticky=document.querySelector('#checkoutStickyInfo');
  if(pickup)pickup.classList.toggle('show',retirada);
  if(delivery)delivery.style.display=retirada?'none':'block';
  if(address)address.style.display=retirada?'none':'block';
  if(pay)pay.style.display=retirada?'none':'block';
  if(note)note.style.display=retirada?'none':'block';
  if(confirm){confirm.style.display='block';confirm.disabled=false;confirm.textContent='CONFIRMAR PEDIDO';}
  if(sticky)sticky.textContent=retirada?'Retirada na loja • taxa R$ 0,00':'Entrega • confirme endereço e rota';
  if(retirada){
    const mainPay=document.querySelector('#paymentMain'),mainNote=document.querySelector('#noteMain');
    if(mainPay)mainPay.value=document.querySelector('#pickupPayment')?.value||'Pix';
    if(mainNote)mainNote.value=document.querySelector('#pickupNote')?.value||'';
  }
}
document.querySelector('#deliveryType')?.addEventListener('change',syncOrderTypeUI);
document.querySelector('#pickupPayment')?.addEventListener('change',e=>{const x=document.querySelector('#paymentMain');if(x)x.value=e.target.value;});
document.querySelector('#pickupNote')?.addEventListener('input',e=>{const x=document.querySelector('#noteMain');if(x)x.value=e.target.value;});

document.querySelector('#orderForm').onsubmit=async e=>{e.preventDefault();if(!cart.length)return;const f=new FormData(e.target),formData=Object.fromEntries(f),subtotal=cart.reduce((s,i)=>s+i.price*i.qty,0);if(formData.delivery==='Retirada'){formData.payment=document.querySelector('#pickupPayment')?.value||formData.payment||'Pix';formData.note=document.querySelector('#pickupNote')?.value||'';formData.address='Retirada na loja';formData.deliveryFee=0;}if(formData.delivery!=='Retirada'&&false&&!findDeliveryZone(formData.neighborhood,formData.street)){alert('Essa região ainda não possui taxa de entrega cadastrada pela loja. Confira o bairro e a rua.');return;}if(formData.delivery!=='Retirada'){
  try{
    const q=(formData.lat&&formData.lng)?await quoteRoadDelivery(formData.lat,formData.lng):await quoteAddressDelivery(formData);
    if(!Number.isFinite(Number(q.distanceKm))||Number(q.distanceKm)<0.1)throw Error('Rota inválida. Confirme o ponto correto no mapa.');
    if(q.lat){formData.lat=q.lat;document.querySelector('#customerLat').value=q.lat;}
    if(q.lng){formData.lng=q.lng;document.querySelector('#customerLng').value=q.lng;}
    formData.deliveryFee=q.deliveryFee;document.querySelector('#deliveryFee').value=q.deliveryFee;
  }catch(err){alert(err.message||'Não foi possível validar a rota da entrega.');return;}
}
const order={customer:formData,items:cart.map(({id,name,price,qty})=>({id,name,price,qty})),subtotal,deliveryFee:formData.delivery==='Retirada'?0:Number(formData.deliveryFee||0),total:subtotal+(formData.delivery==='Retirada'?0:Number(formData.deliveryFee||0))};try{const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(order)});const saved=await r.json();if(!r.ok)throw Error(saved.error||'Erro');const itens=saved.items.map(i=>`${i.qty}x ${i.name} — ${money(i.price*i.qty)}`).join('\n');const tipoPedido=saved.customer.delivery==='Retirada'?'RETIRADA NA LOJA':'ENTREGA';
const msg=`NOVO PEDIDO ${String(saved.number).padStart(2,'0')}\nDATA/HORA: ${saved.createdAtText||new Date(saved.createdAt).toLocaleString('pt-BR')}\nTIPO: ${tipoPedido}\n\nCliente: ${saved.customer.name}\nWhatsApp: ${saved.customer.phone}\n\nPEDIDO:\n${itens}\n\nSUBTOTAL: ${money(saved.subtotal)}\nENTREGA: ${money(saved.deliveryFee)}\nTOTAL: ${money(saved.total)}\n\n${saved.customer.delivery==='Retirada'?'RETIRADA NA LOJA':'ENDEREÇO:\n'+saved.customer.address}\n\nPAGAMENTO: ${saved.customer.payment}\n\nOBSERVAÇÃO:\n${saved.customer.note||'Nenhuma'}`;window.lastOrderWhatsappUrl='https://wa.me/'+String(store.settings.whatsapp||'').replace(/\D/g,'')+'?text='+encodeURIComponent(msg);cart=[];renderCart();document.querySelector('#checkoutModal').classList.remove('show');e.target.reset();setupDelivery();document.querySelector('#successTitle').textContent=`Pedido ${String(saved.number).padStart(2,'0')} confirmado!`;document.querySelector('#successText').textContent=`Pedido realizado em ${saved.createdAtText||new Date(saved.createdAt).toLocaleString('pt-BR')}. Toque em ENVIAR PEDIDO para abrir o WhatsApp.`;const sendBtn=document.querySelector('#sendOrderWhatsapp');
if(sendBtn)sendBtn.style.display='block';
const success=document.querySelector('#successModal');
success?.querySelectorAll('button').forEach(b=>b.style.removeProperty('display'));
success?.classList.add('show');}catch(err){alert(err.message||'Não foi possível enviar o pedido.');}};
loadStore();renderCart();setInterval(loadStore,15000);

function updatePixCheckout(){const pay=document.querySelector('[name="payment"]')?.value;const b=document.querySelector('#pixCheckout');if(!b)return;const show=pay==='Pix'&&store?.settings?.pixKey;b.style.display=show?'flex':'none';if(show){document.querySelector('#pixCheckoutKey').textContent=store.settings.pixKey;document.querySelector('#pixCheckoutRecipient').textContent=(store.settings.pixRecipient||'')+(store.settings.pixType?' · '+store.settings.pixType:'');const im=document.querySelector('#pixCheckoutQr');if(store.settings.pixQr){im.src=store.settings.pixQr;im.style.display='block'}else im.style.display='none'}}
document.querySelector('[name="payment"]')?.addEventListener('change',updatePixCheckout);document.querySelector('#checkoutBtn')?.addEventListener('click',()=>setTimeout(updatePixCheckout,0));document.querySelector('#copyPixBtn')?.addEventListener('click',async()=>{const k=store?.settings?.pixKey||'';if(!k)return;try{await navigator.clipboard.writeText(k)}catch{const t=document.createElement('textarea');t.value=k;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove()}alert('Chave PIX copiada!')});
let lastOrderForReceipt=null;const originalSubmit=document.querySelector('#orderForm').onsubmit;document.querySelector('#orderForm').onsubmit=async function(e){await originalSubmit.call(this,e);};
const receiptBtn=document.querySelector('#sendReceiptBtn');if(receiptBtn)receiptBtn.onclick=()=>{const n=(store?.settings?.botWhatsapp||store?.settings?.whatsapp||'').replace(/\D/g,'');if(n)window.open('https://wa.me/'+n+'?text='+encodeURIComponent('Olá! Já fiz o pagamento PIX e vou enviar o comprovante do meu pedido.'),'_blank')};
new MutationObserver(()=>{const sm=document.querySelector('#successModal');if(receiptBtn&&sm?.classList.contains('show'))receiptBtn.style.display=(document.querySelector('[name="payment"]')?.value==='Pix')?'block':'none'}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});

// V5 ponto de referência: mantém endereço atualizado
setTimeout(()=>{const r=document.querySelector('[name=reference]');if(r)r.addEventListener('input',()=>document.querySelector('[name=number]')?.dispatchEvent(new Event('input')))},0);

async function quoteRoadDelivery(lat,lng){const r=await fetch('/api/delivery-quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat,lng})});const j=await r.json();if(!r.ok)throw Error(j.error||'Não foi possível calcular a rota.');return j}
document.querySelector('#useLocation')?.addEventListener('click',()=>{const st=document.querySelector('#gpsStatus');if(!navigator.geolocation){st.textContent='GPS não disponível neste aparelho.';return}st.textContent='Obtendo localização e calculando rota pelas ruas...';navigator.geolocation.getCurrentPosition(async pos=>{const lat=pos.coords.latitude,lng=pos.coords.longitude;document.querySelector('#customerLat').value=lat;document.querySelector('#customerLng').value=lng;if(true){try{const x=await quoteRoadDelivery(lat,lng);document.querySelector('#deliveryFee').value=x.deliveryFee;document.querySelector('#deliveryFeePreview').textContent=money(x.deliveryFee);st.textContent=`Rota calculada • ${Number(x.distanceKm).toFixed(1)} km • taxa ${money(x.deliveryFee)}`+(x.routeType==='fallback'?' • estimativa temporária':'');}catch(e){document.querySelector('#deliveryFee').value='0';document.querySelector('#deliveryFeePreview').textContent='Fora da área';st.textContent=e.message}}else st.textContent='Localização registrada. A taxa atual é calculada pelo bairro/rua.'},()=>{st.textContent='Não foi possível acessar a localização. Permita o GPS no navegador.'},{enableHighAccuracy:true,timeout:12000,maximumAge:60000})});


// V9.2 — CEP + endereço editável + geocodificação e rota real
async function lookupCepValue(cep){
  const clean=String(cep||'').replace(/\D/g,'');
  if(clean.length!==8) throw Error('Digite um CEP com 8 números.');
  const r=await fetch('/api/cep/'+clean); const j=await r.json();
  if(!r.ok) throw Error(j.error||'CEP não encontrado.'); return j;
}
async function quoteAddressDelivery(data){
  const payload={cep:data.cep||document.querySelector('#cep')?.value||'',street:data.street||document.querySelector('#street')?.value||'',number:data.number||document.querySelector('[name=number]')?.value||'',neighborhood:data.neighborhood||document.querySelector('#neighborhood')?.value||''};
  const r=await fetch('/api/delivery-quote-address',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const j=await r.json();
  if(!r.ok) throw Error(j.error||'Não foi possível localizar esse endereço.'); return j;
}
function formatCepInput(el){let v=el.value.replace(/\D/g,'').slice(0,8);el.value=v.length>5?v.slice(0,5)+'-'+v.slice(5):v;}
document.querySelector('#cep')?.addEventListener('input',e=>formatCepInput(e.target));
document.querySelector('#lookupCep')?.addEventListener('click',async()=>{
  const st=document.querySelector('#cepStatus'), cep=document.querySelector('#cep'); st.textContent='Buscando CEP...';
  try{const x=await lookupCepValue(cep.value); if(x.street)document.querySelector('#street').value=x.street;if(x.neighborhood)document.querySelector('#neighborhood').value=x.neighborhood;st.textContent='CEP encontrado. Confira rua, bairro e informe o número.';document.querySelector('[name=number]')?.focus();document.querySelector('#street').dispatchEvent(new Event('input',{bubbles:true}));}
  catch(e){st.textContent=e.message}
});
async function calculateByTypedAddress(){
  const st=document.querySelector('#gpsStatus'); st.textContent='Localizando endereço e calculando rota...';
  try{const x=await quoteAddressDelivery({});document.querySelector('#customerLat').value=x.lat;document.querySelector('#customerLng').value=x.lng;document.querySelector('#deliveryFee').value=x.deliveryFee;document.querySelector('#deliveryFeePreview').textContent=money(x.deliveryFee);st.textContent=`Endereço localizado • rota ${Number(x.distanceKm).toFixed(1)} km • taxa ${money(x.deliveryFee)}`;return x;}catch(e){document.querySelector('#deliveryFee').value='0';document.querySelector('#deliveryFeePreview').textContent='Confira o endereço';st.textContent=e.message;throw e;}
}
// V9.6 — cálculo automático da entrega pelo endereço (sem botão manual)
let autoDeliveryTimer=null;
let autoCepTimer=null;
let lastAutoAddress='';
function clearAddressQuote(){
  const lat=document.querySelector('#customerLat'),lng=document.querySelector('#customerLng');
  if(lat)lat.value=''; if(lng)lng.value='';
}
function addressReadyForQuote(){
  const cep=(document.querySelector('#cep')?.value||'').replace(/\D/g,'');
  const street=(document.querySelector('#street')?.value||'').trim();
  const nb=(document.querySelector('#neighborhood')?.value||'').trim();
  const num=(document.querySelector('[name=number]')?.value||'').trim();
  return cep.length===8 && street.length>=3 && nb.length>=2 && num.length>0;
}
function scheduleAutomaticDelivery(){
  clearAddressQuote(); clearTimeout(autoDeliveryTimer);
  if(false || !addressReadyForQuote()) return;
  const key=[document.querySelector('#cep')?.value,document.querySelector('#street')?.value,document.querySelector('#neighborhood')?.value,document.querySelector('[name=number]')?.value].join('|');
  autoDeliveryTimer=setTimeout(async()=>{
    if(key===lastAutoAddress && document.querySelector('#customerLat')?.value) return;
    const st=document.querySelector('#gpsStatus'); if(st)st.textContent='Calculando automaticamente a rota e a taxa...';
    try{await calculateByTypedAddress();lastAutoAddress=key;}catch(e){}
  },700);
}
['#street','#neighborhood','[name=number]'].forEach(sel=>document.querySelector(sel)?.addEventListener('input',scheduleAutomaticDelivery));
document.querySelector('#cep')?.addEventListener('input',()=>{
  clearAddressQuote(); clearTimeout(autoCepTimer); clearTimeout(autoDeliveryTimer);
  const cep=document.querySelector('#cep'),clean=(cep?.value||'').replace(/\D/g,'');
  if(clean.length!==8) return;
  autoCepTimer=setTimeout(async()=>{
    const st=document.querySelector('#cepStatus'); if(st)st.textContent='Buscando CEP automaticamente...';
    try{
      const x=await lookupCepValue(cep.value);
      if(x.street)document.querySelector('#street').value=x.street;
      if(x.neighborhood)document.querySelector('#neighborhood').value=x.neighborhood;
      if(st)st.textContent='CEP encontrado. Confira o endereço e informe o número.';
      document.querySelector('#street')?.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[name=number]')?.focus();
      scheduleAutomaticDelivery();
    }catch(e){if(st)st.textContent=e.message;}
  },450);
});
// O GPS permanece como alternativa. O cálculo por endereço não exige botão.

// V10 — envio do pedido pelo WhatsApp em iOS/Android/PC
document.querySelector('#sendOrderWhatsapp')?.addEventListener('click',()=>{
  if(!window.lastOrderWhatsappUrl)return alert('Finalize o pedido primeiro.');
  window.location.href=window.lastOrderWhatsappUrl;
});


// V10.1 — busca, GPS e confirmação manual do ponto no mapa (OpenStreetMap/Leaflet + OSRM)
let deliveryMap=null, deliveryMarker=null, mapQuoteTimer=null, searchTimer=null;

function ensureDeliveryMap(lat,lng){
  const wrap=document.querySelector('#deliveryMapWrap');
  if(!wrap || typeof L==='undefined') return;
  wrap.classList.add('show');
  const y=Number(lat),x=Number(lng);
  if(!deliveryMap){
    deliveryMap=L.map('deliveryMap',{zoomControl:true}).setView([y,x],17);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19, attribution:'© OpenStreetMap'
    }).addTo(deliveryMap);
    deliveryMarker=L.marker([y,x],{draggable:true}).addTo(deliveryMap);
    deliveryMarker.on('dragend',()=>{
      const p=deliveryMarker.getLatLng();
      setConfirmedPoint(p.lat,p.lng,true);
    });
    deliveryMap.on('click',async e=>{
      deliveryMarker.setLatLng(e.latlng);
      await refreshAddressFromPoint(e.latlng.lat,e.latlng.lng);
    });
  }else{
    deliveryMap.setView([y,x],17);
    deliveryMarker.setLatLng([y,x]);
  }
  setTimeout(()=>deliveryMap.invalidateSize(),80);
}

async function reverseCustomerPoint(lat,lng){
  const r=await fetch('/api/customer-location/reverse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat,lng})});
  const x=await r.json(); if(!r.ok)throw Error(x.error||'Não foi possível identificar o ponto.');
  return x;
}
async function setConfirmedPoint(lat,lng,fromDrag=false){
  document.querySelector('#customerLat').value=Number(lat).toFixed(7);
  document.querySelector('#customerLng').value=Number(lng).toFixed(7);
  ensureDeliveryMap(lat,lng);
  const st=document.querySelector('#gpsStatus');
  if(st)st.textContent=fromDrag?'Pino ajustado. Recalculando rota...':'Ponto localizado. Calculando rota...';
  clearTimeout(mapQuoteTimer);
  mapQuoteTimer=setTimeout(async()=>{
    try{
      const q=await quoteRoadDelivery(lat,lng);
      document.querySelector('#deliveryFee').value=q.deliveryFee;
      document.querySelector('#deliveryFeePreview').textContent=money(q.deliveryFee);
      if(st)st.textContent=`Ponto localizado • rota ${Number(q.distanceKm).toFixed(1)} km • taxa ${money(q.deliveryFee)}`;
      const rs=document.querySelector('#routeSummary');
      if(rs){rs.style.display='block';rs.innerHTML=`<b>Entrega calculada pela rota</b><span>${Number(q.distanceKm).toFixed(2)} km → ${money(q.deliveryFee)}</span>`;}
    }catch(e){
      document.querySelector('#deliveryFee').value='';
      document.querySelector('#deliveryFeePreview').textContent='Aguardando rota válida';
      const rs=document.querySelector('#routeSummary');if(rs)rs.style.display='none';
      if(st)st.textContent=e.message||'Confirme um ponto válido no mapa.';
    }
  },250);
}

async function refreshAddressFromPoint(lat,lng){
  const st=document.querySelector('#gpsStatus');
  try{
    if(st)st.textContent='Identificando rua e bairro deste ponto...';
    const rev=await reverseCustomerPoint(lat,lng);
    if(rev.cep)document.querySelector('#cep').value=rev.cep;
    if(rev.street)document.querySelector('#street').value=rev.street;
    if(rev.neighborhood)document.querySelector('#neighborhood').value=rev.neighborhood;
    if(rev.number)document.querySelector('[name=number]').value=rev.number;
    const search=document.querySelector('#addressSearch');
    if(search)search.value=[rev.street,rev.number,rev.neighborhood].filter(Boolean).join(', ');
  }catch(e){}
  await setConfirmedPoint(lat,lng,false);
}
document.querySelector('#confirmMapPoint')?.addEventListener('click',async()=>{
  if(!deliveryMarker)return;
  const p=deliveryMarker.getLatLng();
  await refreshAddressFromPoint(p.lat,p.lng);
  document.querySelector('#deliveryMapWrap')?.classList.remove('show');
  const st=document.querySelector('#gpsStatus');
  if(st)st.textContent='✓ Ponto confirmado. Confira o endereço preenchido e edite somente se necessário.';
  document.querySelector('#addressDetails')?.scrollIntoView({behavior:'smooth',block:'center'});
});

const searchEl=document.querySelector('#addressSearch'), suggestions=document.querySelector('#addressSuggestions');
searchEl?.addEventListener('input',()=>{
  clearTimeout(searchTimer);
  const q=searchEl.value.trim();
  const bairro=(document.querySelector('#neighborhood')?.value||'').trim();
  if(q.length<2){suggestions?.classList.remove('show');const st=document.querySelector('#addressSearchStatus');if(st)st.textContent=q.length?'Digite mais uma letra para buscar.':'';return;}
  searchTimer=setTimeout(async()=>{
    const st=document.querySelector('#addressSearchStatus');
    if(st)st.textContent='Buscando ruas e endereços...';
    try{
      const r=await fetch('/api/address-search?q='+encodeURIComponent(q)+'&neighborhood='+encodeURIComponent(bairro));
      const arr=await r.json(); if(!r.ok)throw Error(arr.error||'Erro na busca');
      suggestions.innerHTML=arr.map((x,i)=>`<div class="address-suggestion" data-i="${i}"><b>${esc((x.label||'').split(',').slice(0,2).join(','))}</b><small>${esc((x.label||'').split(',').slice(2).join(','))}</small></div>`).join('');
      suggestions.classList.toggle('show',arr.length>0);
      if(st)st.textContent=arr.length?`${arr.length} resultado(s). Toque no endereço correto.`:'Nenhum endereço encontrado. Tente só parte do nome da rua.';
      suggestions.querySelectorAll('.address-suggestion').forEach(el=>el.onclick=async()=>{
        const x=arr[Number(el.dataset.i)],a=x.address||{};
        searchEl.value=x.label||q;suggestions.classList.remove('show');
        const road=a.road||a.pedestrian||a.residential||'';
        const nb=a.suburb||a.neighbourhood||a.quarter||a.city_district||'';
        const num=a.house_number||'';
        if(road)document.querySelector('#street').value=road;
        if(nb)document.querySelector('#neighborhood').value=nb;
        if(num)document.querySelector('[name=number]').value=num;
        if(a.postcode)document.querySelector('#cep').value=a.postcode;
        document.querySelector('[name=number]')?.dispatchEvent(new Event('input',{bubbles:true}));
        await setConfirmedPoint(x.lat,x.lng,false);
      });
     }catch(e){suggestions.innerHTML='';suggestions.classList.remove('show');if(st)st.textContent=e.message||'Não foi possível buscar agora.';}
  },220);
});

// Reforça o GPS: mostra o ponto obtido no mapa para o cliente corrigir se necessário.
document.querySelector('#useLocation')?.addEventListener('click',()=>{
  if(!navigator.geolocation)return;
  navigator.geolocation.getCurrentPosition(async pos=>{
    const {latitude:lat,longitude:lng,accuracy}=pos.coords;
    ensureDeliveryMap(lat,lng);
    await setConfirmedPoint(lat,lng,false);
    const st=document.querySelector('#gpsStatus');
    if(st)st.textContent += ` • precisão GPS ±${Math.round(accuracy)} m. Arraste o pino se necessário.`;
  },()=>{}, {enableHighAccuracy:true,timeout:15000,maximumAge:0});
},true);

document.querySelector('#neighborhood')?.addEventListener('change',()=>{
  const bairro=document.querySelector('#neighborhood').value.trim();
  const busca=document.querySelector('#addressSearch');
  if(bairro && busca && !busca.value.trim()){
    busca.placeholder='Buscar rua em '+bairro;
  }
});

async function runAddressSearch(){
  const input=document.querySelector('#addressSearch'),box=document.querySelector('#addressSuggestions'),status=document.querySelector('#addressSearchStatus');
  const q=(input?.value||'').trim(),bairro=(document.querySelector('#neighborhood')?.value||'').trim();
  if(q.length<2 && bairro.length<2){if(status)status.textContent='Digite uma rua ou informe o bairro.';return;}
  if(status)status.textContent='Buscando ruas e endereços no mapa...';
  try{
    const r=await fetch('/api/address-search?q='+encodeURIComponent(q)+'&neighborhood='+encodeURIComponent(bairro));
    let arr=await r.json(); if(!r.ok)throw Error(arr.error||'Falha na busca.');
    // Se o cliente informou somente bairro, usa o ponto do bairro para listar ruas mapeadas ao redor.
    if(!q && bairro && arr.length){
      const center=arr[0];
      try{
        const rr=await fetch(`/api/nearby-roads?lat=${encodeURIComponent(center.lat)}&lng=${encodeURIComponent(center.lng)}`);
        const roads=await rr.json();
        if(rr.ok && roads.length){
          box.innerHTML=roads.map((x,i)=>`<div class="address-suggestion" data-road-i="${i}"><b>${esc(x.name)}</b><small>${esc(bairro)} • rua mapeada próxima</small></div>`).join('');
          box.classList.add('show');status.textContent=roads.length+' rua(s) mapeada(s) encontrada(s).';
          box.querySelectorAll('[data-road-i]').forEach(el=>el.onclick=()=>{
            const x=roads[Number(el.dataset.roadI)];
            input.value=x.name; document.querySelector('#street').value=x.name;
            box.classList.remove('show'); status.textContent='Rua selecionada. Informe o número ou ajuste o ponto no mapa.';
            runAddressSearch();
          });
          return;
        }
      }catch(e){}
    }
    if(!arr.length){box.innerHTML='';box.classList.remove('show');if(status)status.textContent='Nenhum endereço encontrado. Tente parte do nome da rua ou use o mapa/GPS.';return;}
    box.innerHTML=arr.map((x,i)=>`<div class="address-suggestion" data-manual-i="${i}"><b>${esc((x.label||'').split(',').slice(0,2).join(','))}</b><small>${esc((x.label||'').split(',').slice(2).join(','))}</small></div>`).join('');
    box.classList.add('show');status.textContent=arr.length+' resultado(s). Selecione o correto.';
    box.querySelectorAll('[data-manual-i]').forEach(el=>el.onclick=async()=>{
      const x=arr[Number(el.dataset.manualI)],a=x.address||{};
      input.value=x.label||q;box.classList.remove('show');
      const road=a.road||a.pedestrian||a.residential||'',nb=a.suburb||a.neighbourhood||a.quarter||a.city_district||bairro;
      if(road)document.querySelector('#street').value=road;if(nb)document.querySelector('#neighborhood').value=nb;
      if(a.house_number)document.querySelector('[name=number]').value=a.house_number;if(a.postcode)document.querySelector('#cep').value=a.postcode;
      await refreshAddressFromPoint(x.lat,x.lng);
      status.textContent='Endereço selecionado. Confira ou ajuste o ponto no mapa.';
    });
  }catch(e){if(status)status.textContent=e.message||'Não foi possível buscar agora.';}
}
document.querySelector('#searchAddressBtn')?.addEventListener('click',runAddressSearch);
document.querySelector('#addressSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runAddressSearch();}});

// Localização organizada: GPS ou busca de endereço.
document.querySelector('#toggleAddressSearch')?.addEventListener('click',()=>{
  const area=document.querySelector('#addressSearchArea');
  area?.classList.toggle('show');
  if(area?.classList.contains('show'))document.querySelector('#addressSearch')?.focus();
});

document.querySelector('#useLocationTop')?.addEventListener('click',()=>{
  const st=document.querySelector('#gpsStatus');
  if(!navigator.geolocation){if(st)st.textContent='GPS não disponível neste aparelho.';return;}
  if(st)st.textContent='Obtendo sua localização...';
  navigator.geolocation.getCurrentPosition(async pos=>{
    const lat=pos.coords.latitude,lng=pos.coords.longitude;
    try{
      const rev=await reverseCustomerPoint(lat,lng);
      if(rev.cep)document.querySelector('#cep').value=rev.cep;
      if(rev.street)document.querySelector('#street').value=rev.street;
      if(rev.neighborhood)document.querySelector('#neighborhood').value=rev.neighborhood;
      if(rev.number)document.querySelector('[name=number]').value=rev.number;
      const search=document.querySelector('#addressSearch');
      if(search)search.value=[rev.street,rev.number,rev.neighborhood].filter(Boolean).join(', ');
      await setConfirmedPoint(lat,lng,false);
      if(st)st.textContent=`Localização encontrada (precisão aproximada ±${Math.round(pos.coords.accuracy)} m). Confira o número e o pino no mapa.`;
    }catch(e){
      ensureDeliveryMap(lat,lng);
      await setConfirmedPoint(lat,lng,false);
      if(st)st.textContent='GPS localizado. Complete o que faltar no endereço e confira o pino.';
    }
  },()=>{
    if(st)st.textContent='Não foi possível acessar sua localização. Permita o GPS ou use Buscar endereço.';
  },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
});

document.addEventListener('DOMContentLoaded',()=>setTimeout(syncOrderTypeUI,0));
