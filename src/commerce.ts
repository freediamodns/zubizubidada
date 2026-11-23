import {adminPage} from './admin.ts';
import type { D1Database } from '@cloudflare/workers-types';
import {panel,plans,wallets} from './catalog.ts';
type Env={DB:D1Database & {botHosting?:(uid:number)=>Promise<unknown[]>,renewBotFree?:(uid:number)=>Promise<boolean>},PTERO_API_KEY?:string,HOSTING_CONFIG?:string,BILLING_JOB_KEY?:string,SSO_SECRET?:string,SOL_RPC?:string};
type Order={id:string,uid:number,plan:string,term:string,runtime:string,coin:keyof typeof wallets,units:number,created:number,status:string,tx:string|null,sid:number|null,server:string|null,expires:number|null};
const now=()=>Math.floor(Date.now()/1000);
const id=()=>crypto.randomUUID();
const json=(o:unknown,status=200,headers:Record<string,string>={})=>Response.json(o,{status,headers:{'cache-control':'no-store',...headers}});
class Problem extends Error{}
async function remote(url:string,init?:RequestInit){const r=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Problem('Service temporarily unavailable. Try again later.');return r.json() as Promise<any>}
async function ptero(e:Env,path:string,body?:unknown,optional=false){
 const r=await fetch(panel+'/api/application'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+e.PTERO_API_KEY,'Content-Type':'application/json',Accept:'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});
 if(optional&&r.status===404)return null;if(!r.ok)throw new Problem(r.status===422?'Panel rejected the details. Check the account or host configuration.':'Panel service unavailable.');return r.status===204?null:r.json() as Promise<any>;
}
async function rpc(e:Env,method:string,params:unknown[]){const obj=await remote(e.SOL_RPC||'https://api.mainnet.solana.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(obj.error)throw new Problem('Solana verification is busy.');return obj.result}
async function proof(e:Env,o:Order,hash:string){
 if(o.coin==='LTC'){if(!/^[a-f0-9]{64}$/.test(hash))return false;
 const t=await remote('https://litecoinspace.org/api/tx/'+hash);
 if(!t.status.confirmed||t.status.block_time<o.created||t.status.block_time>o.created+3600)return false;
 const tip=await remote('https://litecoinspace.org/api/blocks/tip/height');
 return tip-t.status.block_height>=5&&t.vout.some((v:any)=>v.scriptpubkey_address===wallets.LTC&&v.value===o.units);}
 if(!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(hash))return false;
 if(await rpc(e,'getGenesisHash',[])!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Problem('Solana mainnet required.');
 const t=await rpc(e,'getTransaction',[hash,{commitment:'finalized',encoding:'jsonParsed',maxSupportedTransactionVersion:0}]);
 if(!t||!t.meta||t.meta.err||t.blockTime<o.created||t.blockTime>o.created+3600)return false;
 const msg=t.transaction.message,idx=msg.accountKeys.findIndex((k:any)=>k.pubkey===wallets.SOL);
 return idx>=0&&t.meta.postBalances[idx]-t.meta.preBalances[idx]>=o.units&&msg.instructions.some((i:any)=>i.programId==='11111111111111111111111111111111'&&i.parsed?.type==='transfer'&&i.parsed.info.destination===wallets.SOL&&i.parsed.info.lamports===o.units);
}
async function processOrder(e:Env,o:Order,hash?:string){
 const sql=(q:string,...a:unknown[])=>e.DB.prepare(q).bind(...a);
 if(o.status==='waiting'){
 let candidates:string[]=[];
 if(hash)candidates=[hash];
 else if(o.coin==='SOL'){const list=await rpc(e,'getSignaturesForAddress',[wallets.SOL,{limit:8,commitment:'finalized'}]);candidates=list.filter((s:any)=>!s.err&&s.blockTime>=o.created).map((s:any)=>s.signature);}
 else{const list=await remote('https://litecoinspace.org/api/address/'+wallets.LTC+'/txs/chain');candidates=list.filter((t:any)=>t.vout.some((v:any)=>v.value===o.units&&v.scriptpubkey_address===wallets.LTC)).map((t:any)=>t.txid);}
 for(const h of candidates){if(await proof(e,o,h)){await sql("UPDATE invoices SET status='paid',tx=? WHERE id=? AND status='waiting'",h,o.id).run();o.status='paid';break;}}
 if(o.status==='waiting'&&now()>o.created+86400){await sql("UPDATE invoices SET status='review' WHERE id=? AND status='waiting'",o.id).run();return}
 }
 if(o.status==='paid'){
 const c=JSON.parse(e.HOSTING_CONFIG!),p=plans.find(p=>p.name===o.plan)!,key='scweb-'+o.id;
 let obj=await ptero(e,'/servers/external/'+key,undefined,true);
 if(!obj)obj=await ptero(e,'/servers',{...c.runtimes[o.runtime],external_id:key,user:o.uid,name:o.plan+' '+o.runtime,limits:{memory:p.ram*1024,swap:0,disk:p.disk*1024,io:500,cpu:p.cpu},feature_limits:{databases:0,allocations:0,backups:0},deploy:{locations:[c.location_id],dedicated_ip:false,port_range:[]},start_on_completion:false});
 await sql("UPDATE invoices SET status='active',sid=?,server=?,expires=? WHERE id=? AND status='paid'",obj.attributes.id,obj.attributes.identifier,o.plan==='Free'?now()+172800:o.term==='monthly'?now()+2592000:null,o.id).run();
 }
 if(o.status==='active'&&o.expires&&o.expires<=now()){const obj=await ptero(e,'/servers/'+o.sid);if(!obj.attributes.suspended)await ptero(e,'/servers/'+o.sid+'/suspend',{});await sql("UPDATE invoices SET status='expired' WHERE id=?",o.id).run()}
}
export async function commerce(request:Request,raw:unknown){
 const e=raw as Env,url=new URL(request.url),action=url.pathname.split('/').pop();
 const sql=(q:string,...a:unknown[])=>e.DB.prepare(q).bind(...a);
 const tok=(request.headers.get('cookie')||'').match(/(?:^|; )sc_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
 const user=tok?await sql('SELECT uid,sso FROM sessions WHERE token=? AND expires>?',tok,now()).first<{uid:number,sso:number}>():null;
 const ready=!!(e.PTERO_API_KEY&&e.HOSTING_CONFIG&&e.BILLING_JOB_KEY);
 const admin=async()=>{if(!user?.sso||!e.PTERO_API_KEY)return false;const obj=await ptero(e,'/users/'+user.uid,undefined,true);return obj?.attributes?.root_admin===true};
 if(url.pathname==='/admin' || action==='admin'){
 if(request.method!=='GET'||!await admin())return json({error:'Administrator access required.'},403);
 const rows=(await sql('SELECT plan,status,count(*) AS total FROM invoices GROUP BY plan,status ORDER BY plan,status').all()).results;
 if(action==='admin'&&url.pathname!=='/admin')return json({rows});
 return new Response(adminPage(rows as {plan:string,status:string,total:number}[]),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});}
 if(action==='invoice')return json({error:'Buy hosting in the ShinchanCloud Discord.'},410);
 if(action==='signin'){
 if(!e.SSO_SECRET||!e.PTERO_API_KEY)return json({error:'Panel sign-in is awaiting host setup.'},503);
 const nonce=id();await sql("INSERT INTO challenges(id,username,expires) VALUES (?,'sso',?)",nonce,now()+300).run();
 return new Response(null,{status:302,headers:{Location:panel+'/shinchan-signin?state='+nonce,'set-cookie':'sc_state='+nonce+'; Path=/shop/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=300','cache-control':'no-store'}});}
 if(action==='callback'){
 const nonce=url.searchParams.get('state')||'',uid=Number(url.searchParams.get('uid')),exp=Number(url.searchParams.get('exp')),sig=url.searchParams.get('sig')||'';
 if(!e.SSO_SECRET||!Number.isSafeInteger(uid)||uid<1||exp<now()||exp>now()+120||!Number.isSafeInteger(exp)||!/^[-a-f0-9]{36}$/.test(nonce)||!request.headers.get('cookie')?.split('; ').includes('sc_state='+nonce)||!/^[0-9a-f]{64}$/.test(sig))return json({},403);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(e.SSO_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const valid=await crypto.subtle.verify('HMAC',key,Uint8Array.from(sig.match(/../g)!,v=>parseInt(v,16)),new TextEncoder().encode(nonce+'|'+uid+'|'+exp));
 if(!valid||!(await sql("DELETE FROM challenges WHERE id=? AND username='sso' AND expires>?",nonce,now()).run()).meta.changes)return json({},403);
 const token=id();await sql('INSERT INTO sessions(token,uid,expires,sso) VALUES (?,?,?,1)',token,uid,now()+3600).run();
 return new Response(null,{status:303,headers:{location:'/#checkout','cache-control':'no-store','set-cookie':'sc_session='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600'}});}
 if(action==='state'&&request.method==='GET')return json({linked:!!user,botHosting:user&&e.DB.botHosting?await e.DB.botHosting(user.uid):[],admin:await admin(),ready,sso:!!(e.SSO_SECRET&&e.PTERO_API_KEY),accounts:!!e.PTERO_API_KEY,orders:user?(await sql('SELECT * FROM invoices WHERE uid=? ORDER BY created DESC LIMIT 10',user.uid).all()).results:[]});
 if(request.method!=='POST')return json({error:'Use POST'},405);
 if(action==='tick'){
 if(!e.BILLING_JOB_KEY||request.headers.get('authorization')!=='Bearer '+e.BILLING_JOB_KEY)return json({},403);
 const rows=await sql("SELECT * FROM invoices WHERE status IN ('waiting','paid') OR (status='active' AND expires<=?) ORDER BY random() LIMIT 3",now()).all<Order>();
 for(const o of rows.results)await processOrder(e,o);return json({processed:rows.results.length});}
 if(request.headers.get('origin')!==url.origin||!request.headers.get('content-type')?.startsWith('application/json'))return json({},403);
 try{
 const b=await request.json() as Record<string,string>;
 if(action==='logout'){if(tok)await sql('DELETE FROM sessions WHERE token=?',tok).run();return json({ok:true},200,{'set-cookie':'sc_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax'});}
 if(!e.PTERO_API_KEY)throw new Problem('Account setup is awaiting host configuration.');
 const k=(request.headers.get('cf-connecting-ip')||'local')+':'+Math.floor(now()/600);
 const n=await sql('INSERT INTO attempts VALUES (?,1) ON CONFLICT(k) DO UPDATE SET n=n+1 RETURNING n',k).first<{n:number}>();
 if(!n||n.n>50)return json({error:'Please try again in ten minutes.'},429);
 if(action==='signup'){
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/.test(b.username||''))throw new Problem('Enter a 3–32 character panel username.');
 if(!b.password||b.password.length<12||b.password.length>128)throw new Problem('Use a password of 12–128 characters.');
 const linkCode=id().replaceAll('-','');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(linkCode));
 const external_id='scweb-link-'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
 const account=await ptero(e,'/users',{username:b.username,email:'web-'+id()+'@accounts.invalid',password:b.password,first_name:b.username,last_name:'Customer',external_id,root_admin:false});
 const token=id();await sql('INSERT INTO sessions(token,uid,expires) VALUES (?,?,?)',token,account.attributes.id,now()+604800).run();
 return json({ok:true,linkCode},201,{'set-cookie':'sc_session='+token+'; Max-Age=604800; Path=/; Secure; HttpOnly; SameSite=Lax'});
 }
 if(!user)return json({error:'Link your panel account first.'},401);
 if(action==='free'){
 if(e.DB.renewBotFree && await e.DB.renewBotFree(user.uid))return json({ok:true});
 if(!e.HOSTING_CONFIG||!e.BILLING_JOB_KEY)throw new Problem('Free claims open when the hosting node is connected.');
 if(!['Python','Node.js'].includes(b.runtime))throw new Problem('Choose a runtime.');
 let o=await sql("SELECT * FROM invoices WHERE uid=? AND plan='Free'",user.uid).first<Order>();
 if(!o){
 await sql("INSERT OR IGNORE INTO invoices(id,uid,plan,term,runtime,coin,units,created,status) VALUES(?,?,'Free','free',?,'FREE',?,?,'paid')",id(),user.uid,b.runtime,user.uid,now()).run();
 o=await sql("SELECT * FROM invoices WHERE uid=? AND plan='Free'",user.uid).first<Order>();
 }
 if(!o)throw new Problem('Please retry your claim.');
 if(o.status==='expired'&&o.sid){await ptero(e,'/servers/'+o.sid+'/unsuspend',{});}
 if(o.sid){await sql("UPDATE invoices SET status='active',expires=? WHERE id=?",now()+172800,o.id).run();}
 else await processOrder(e,o);
 return json({ok:true});
 }
 if(!ready)throw new Problem('Checkout opens after the host connects billing and provisioning.');
 if(action==='check'){
 const o=await sql('SELECT * FROM invoices WHERE uid=? AND id=?',user.uid,b.id).first<Order>();if(!o)throw new Problem('Unknown invoice.');
 await processOrder(e,o,b.hash||undefined);return json({ok:true});}
 return json({},404);
 }catch(err){return json({error:err instanceof Problem?err.message:'Request could not finish. Check your account and try again.'},400)}
}
