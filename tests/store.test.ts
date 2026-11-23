import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {commerce} from '../src/commerce.ts';
import {plans} from '../src/catalog.ts';
const host='https://shop.example.com';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/schema.sql','utf8'));
 const env={DB:{prepare(q:string){return {bind(...args:any[]){const s=db.prepare(q);return {first:async()=>s.get(...args),all:async()=>({results:s.all(...args)}),run:async()=>({meta:{changes:Number(s.run(...args).changes)}})}}}}},PTERO_API_KEY:'local-test',BILLING_JOB_KEY:'x',HOSTING_CONFIG:JSON.stringify({location_id:2,runtimes:{Python:{egg:1},'Node.js':{egg:2}}})};
 const key=crypto.randomUUID();const req=(path:string,body?:unknown,token?:string,origin=host)=>commerce(new Request(host+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',origin,cookie:'sc_session='+(token||'')},body:body?JSON.stringify(body):undefined}),env);
 function session(sso=0){db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(key,7,2000000000,sso)}
 return {db,env,req,session,key};}
test('public browsing; private admin and checkout; cross-site rejection',async()=>{
 const {req}=fixture();assert.equal((await req('/shop/state')).status,200);
 assert.equal((await req('/admin')).status,403);assert.equal((await req('/shop/admin')).status,403);
 assert.equal((await req('/shop/free',{runtime:'Python'})).status,401);
 assert.equal((await req('/shop/signup',{},undefined,'https://elsewhere.test')).status,403);
});
test('server verifies admin for each dashboard request, including after demotion',async(t)=>{
 const {req,key,session}=fixture();session(1);let root=true;
 t.mock.method(globalThis,'fetch',async()=>Response.json({attributes:{root_admin:root}}));
 assert.equal((await req('/admin',undefined,key)).status,200);
 root=false;assert.equal((await req('/admin',undefined,key)).status,403);
 assert.equal((await req('/shop/admin',undefined,key)).status,403);
});
test('single Free allocation across repeat claims; runtime reaches provisioning',async(t)=>{
 const {req,key,session,db}=fixture();session();let creates=0;
 t.mock.method(globalThis,'fetch',async(url:string,init:any)=>{if(url.includes('/external/'))return new Response(null,{status:404});
 creates++;assert.equal(JSON.parse(init.body).egg,2);return Response.json({attributes:{id:123,identifier:'srv'}})});
 assert.equal((await req('/shop/free',{runtime:'Node.js'},key)).status,200);
 assert.equal((await req('/shop/free',{runtime:'Python'},key)).status,200);
 assert.equal(creates,1);assert.equal(db.prepare('SELECT count(*) n FROM invoices').get()?.n,1);
});
test('paid sales go to Discord without creating a website order',async()=>{
 const {req,db}=fixture();assert.equal((await req('/shop/invoice',{plan:'Basic'})).status,410);
 assert.equal(db.prepare('SELECT count(*) n FROM invoices').get()?.n,0);
 assert.deepEqual(plans.slice(2).map(p=>[p.monthly,p.lifetime]),[[1.5,12],[3,24],[6,48],[12,144]]);
});
test('signup binds the private link code to a non-admin panel account',async(t)=>{
 const {req}=fixture();let payload;
 t.mock.method(globalThis,'fetch',async(_,init)=>{payload=JSON.parse(init.body);return Response.json({attributes:{id:9}})});
 const r=await req('/shop/signup',{username:'example',password:'sample-passphrase'});
 const {linkCode}=await r.json();
 assert.equal(r.status,201);assert.equal(payload.root_admin,false);
 const {createHash}=await import('node:crypto');
 assert.equal(payload.external_id,'scweb-link-'+createHash('sha256').update(linkCode).digest('hex'));
});
test('confirmed LTC creates the selected Node.js server once',async(t)=>{
 const {req,key,session,db}=fixture();session();
 const h='f'.repeat(64),stamp=Math.floor(Date.now()/1000);
 db.prepare("INSERT INTO invoices(id,uid,plan,term,runtime,coin,units,created) VALUES('receipt',7,'Plus','monthly','Node.js','LTC',15000,?)").run(stamp);
 let creates=0;
 t.mock.method(globalThis,'fetch',async(url:string,init:any)=>{
 if(url.endsWith('/tx/'+h))return Response.json({status:{confirmed:true,block_time:stamp,block_height:50},vout:[{scriptpubkey_address:'La63Hxe6wVphm4GE7ywKvumCLDLi4b9jj4',value:15000}]});
 if(url.endsWith('/tip/height'))return Response.json(55);
 if(url.includes('/external/'))return new Response(null,{status:404});
 if(url.endsWith('/servers')){creates++;const b=JSON.parse(init.body);assert.equal(b.egg,2);assert.equal(b.user,7);assert.equal(b.limits.memory,16384);return Response.json({attributes:{id:21,identifier:'srv'}})}
 throw Error('unexpected request')});
 for(let i=0;i<2;i++)assert.equal((await req('/shop/check',{id:'receipt',hash:h},key)).status,200);
 assert.equal(creates,1);assert.equal(db.prepare('SELECT status FROM invoices').get()?.status,'active');
});
