const { spawn } = require('child_process');
const http = require('http');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const ports = Array.from({length: 11}, (_, i) => 3000 + i);
let serverProcess;
let stopped = false;

function checkPort(port) {
  return new Promise(resolve => {
    const req = http.get({hostname:'127.0.0.1', port, path:'/api/health', timeout:900}, res => {
      let data='';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j && j.ok === true && j.store === 'CHEFE TELLES' && j.version === '1.9.0');
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function findServer() {
  for (const port of ports) if (await checkPort(port)) return port;
  return null;
}

function open(url) {
  exec(`start "" "${url}"`, {windowsHide:false});
}

async function main() {
  console.clear();
  console.log('========================================');
  console.log('       CHEFE TELLES - INICIADOR');
  console.log('========================================\n');
  console.log('Iniciando servidor...');

  serverProcess = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    windowsHide: false,
    stdio: 'inherit'
  });

  serverProcess.on('exit', code => {
    if (!stopped && code !== 0) console.log(`\nServidor encerrou com código ${code}.`);
  });

  let port = null;
  for (let i=0; i<60 && !port; i++) {
    await new Promise(r => setTimeout(r, 350));
    port = await findServer();
  }

  if (!port) {
    console.log('\nERRO: o CHEFE TELLES não conseguiu iniciar.');
    console.log('Verifique se o Node.js está instalado e se as portas 3000-3010 estão disponíveis.');
    process.exitCode = 1;
    return;
  }

  const base = `http://127.0.0.1:${port}`;
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of (list || [])) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  const lan = [...new Set(ips)][0] || null;
  console.log('\n========================================');
  console.log('       CHEFE TELLES - ONLINE v2.0');
  console.log('========================================');
  console.log(`Loja PC :      ${base}/`);
  console.log(`Dono PC :      ${base}/admin`);
  if (lan) {
    console.log(`Loja CELULAR:  http://${lan}:${port}/`);
    console.log(`Dono CELULAR:  http://${lan}:${port}/admin`);
  } else {
    console.log('Rede:           IP da rede não detectado.');
  }
  console.log(`Teste Thermer: ${base}/thermer-test.html`);
  console.log('\nAbrindo a loja e o painel do dono...');

  open(base + '/');
  await new Promise(r => setTimeout(r, 700));
  open(base + '/admin');
  console.log('\nNão feche esta janela enquanto estiver usando o sistema.');
}

process.on('SIGINT', () => { stopped=true; if(serverProcess) serverProcess.kill(); process.exit(); });
main();
