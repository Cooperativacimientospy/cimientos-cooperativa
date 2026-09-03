// Isolated visual QA. Never connects to Supabase or serves production config.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    res.setHeader('Cache-Control','no-store');
    if(pathname==='/invitation-preview.html') {
      res.setHeader('Content-Type','text/html');
      const html=await readFile(path.join(root,'panel.html'),'utf8');
      return res.end(html.replace('</body>',`<script>document.getElementById('loginScreen').style.display='grid';CimientosInvitation.present({getUser:async()=>({data:{user:{id:'fixture'}}}),updateUser:async()=>({error:null}),signOut:async()=>({error:null})},'fixture',()=>document.getElementById('loginScreen').style.display='none');</script></body>`));
    }
    if(pathname==='/compact.html') {res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>Prueba compacta aislada</title><iframe title="Panel a 390 píxeles" src="panel.html" style="width:390px;height:844px;border:0"></iframe>');}
    if(pathname==='/config.js') {res.setHeader('Content-Type','text/javascript');return res.end('const SUPABASE_URL="";const SUPABASE_ANON_KEY="";const LOGIN_REQUIRED=false;const SITE_URL="";');}
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root)) {res.writeHead(403);return res.end();}
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch {res.writeHead(404);res.end();}
}).listen(8796,'127.0.0.1',()=>console.log('Offline preview: http://127.0.0.1:8796/panel.html'));
