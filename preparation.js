(function(root){
 const closed=['Pronto','Saiu para entrega','Entregue','Cancelado'];
 function range(data={}){
  const valid=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0;
  const max=valid(data.preparationMaxMinutes)?Number(data.preparationMaxMinutes):valid(data.estimatedMinutes)?Number(data.estimatedMinutes):valid(data.defaultPrepMaxMinutes)?Number(data.defaultPrepMaxMinutes):valid(data.defaultEtaMinutes)?Number(data.defaultEtaMinutes):40;
  const min=valid(data.preparationMinMinutes)?Number(data.preparationMinMinutes):valid(data.defaultPrepMinMinutes)?Number(data.defaultPrepMinMinutes):Math.min(30,max);
  return {min:Math.min(min,max),max};
 }
 function label(data){const r=range(data);return r.min===r.max?r.max+' minutos':r.min+' a '+r.max+' minutos';}
 function timer(data,now=Date.now()){
  const start=Date.parse(data.createdAt);if(!Number.isFinite(start))return 'Horário do pedido indisponível';
  const ended=Date.parse(data.preparationEndedAt),done=closed.includes(data.status);
  if(done&&!Number.isFinite(ended))return 'Preparo encerrado';
  const seconds=Math.max(0,Math.floor(((done&&Number.isFinite(ended)?ended:now)-start)/1000));
  const minutes=Math.floor(seconds/60),display=String(minutes).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  return (done?'Preparo encerrado em: ':'Tempo decorrido: ')+display+(!done&&seconds>range(data).max*60?' · Preparo acima do previsto':'');
 }
 const api={range,label,timer};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CheffPreparation=api;
})(typeof window!=='undefined'?window:globalThis);
