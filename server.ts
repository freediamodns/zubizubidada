import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {commerce} from './src/commerce.ts';
const E=process.env, origin=E.SHOP_ORIGIN||'http://localhost:8080';
function localStore(){
mkdirSync('data',{recursive:true,mode:0o700});
const db=new DatabaseSync('data/shop.sqlite');db.exec('PRAGMA journal_mode=WAL');db.exec(readFileSync('migrations/schema.sql','utf8'));
return {prepare(q:string){return {bind(...args:any[]){const stmt=db.prepare(q);return {first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}})}}}}};
}
const DB=E.SUPABASE_DB_URL?await (await import('./src/postgres.ts')).connectStore(E.SUPABASE_DB_URL):localStore();
const config=E.HOSTING_CONFIG_FILE&&existsSync(E.HOSTING_CONFIG_FILE)?readFileSync(E.HOSTING_CONFIG_FILE,'utf8').replace(/^\uFEFF/,''):'';
const env={...E,DB,HOSTING_CONFIG:E.ENABLE_CHECKOUT==='true'?config:'',SSO_SECRET:(E.SSO_SECRET||'').length>=32?E.SSO_SECRET:''};
const headers={'x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','permissions-policy':'camera=(),microphone=(),geolocation=()','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'","cache-control":"no-store"};
const assets=new Map([['/',['public/index.html','text/html']],['/assets/style.css',['public/assets/style.css','text/css']],['/assets/app.js',['public/assets/app.js','application/javascript']],['/assets/datacenter.webp',['public/assets/datacenter.webp','image/webp']],['/assets/icon.svg',['public/assets/icon.svg','image/svg+xml']],['/assets/ktshost.png',['public/assets/ktshost.png','image/png']]]);
const server=createServer(async(req,res)=>{
 try{
 const url=new URL(req.url||'/',origin);
 if(url.origin!==origin){res.writeHead(400,headers).end();return}
 const path=url.pathname;
 const asset=assets.get(path);if(!asset||req.method!=='GET'){res.writeHead(404,headers).end();return}
 res.writeHead(200,{...headers,'content-type':asset[1]}).end(readFileSync(asset[0]));
 }catch{if(!res.headersSent)res.writeHead(503,{...headers,'content-type':'application/json'});res.end(JSON.stringify({error:'Service temporarily unavailable.'}))}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(E.PORT||8080),E.BIND_HOST||'127.0.0.1');
let running=false;
setInterval(async()=>{if(running||!env.BILLING_JOB_KEY||!env.HOSTING_CONFIG)return;running=true;
try{await commerce(new Request(origin+'/shop/tick',{method:'POST',headers:{authorization:'Bearer '+env.BILLING_JOB_KEY}}),env)}
catch{console.warn('Billing worker will retry.')}finally{running=false}},60000).unref();
