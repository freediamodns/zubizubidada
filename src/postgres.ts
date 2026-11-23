import {readFileSync} from 'node:fs';
export async function connectStore(uri:string){
 const {default:pg}=await import('pg');
 pg.types.setTypeParser(20,(v:string)=>Number.isSafeInteger(Number(v))?Number(v):v);
 const url=new URL(uri);for(const k of ['sslmode','sslcert','sslrootcert','sslkey'])url.searchParams.delete(k);
 const pool=new pg.Pool({connectionString:url.href,max:4,connectionTimeoutMillis:10000,ssl:{rejectUnauthorized:true,...(process.env.SUPABASE_CA_FILE?{ca:readFileSync(process.env.SUPABASE_CA_FILE,'utf8')}:{})},options:'-c search_path=shinchan_store -c statement_timeout=12000'});
 pool.on('error',()=>console.error('Database connection interrupted.'));
 const conn=await pool.connect();
 try{
 await conn.query('BEGIN');
 await conn.query("SELECT pg_advisory_xact_lock(129441167)");
 await conn.query('CREATE SCHEMA IF NOT EXISTS shinchan_store');
 await conn.query('REVOKE ALL ON SCHEMA shinchan_store FROM PUBLIC,anon,authenticated');
 await conn.query(readFileSync('migrations/schema.sql','utf8').replaceAll('INTEGER','BIGINT'));
 await conn.query('REVOKE ALL ON ALL TABLES IN SCHEMA shinchan_store FROM PUBLIC,anon,authenticated');
 await conn.query('COMMIT');
 }catch(err){await conn.query('ROLLBACK');throw err}finally{conn.release()}
 const botTables=(await pool.query("SELECT to_regclass('shinchancloud.accounts') IS NOT NULL AND to_regclass('shinchancloud.leases') IS NOT NULL AS ok")).rows[0].ok;
 return {
 prepare(q:string){let i=0;let text=q.replace(/\?/g,()=>'$'+(++i));
 if(text.startsWith('INSERT OR IGNORE INTO '))text=text.replace('INSERT OR IGNORE INTO ','INSERT INTO ')+' ON CONFLICT DO NOTHING';
 return {bind(...args:unknown[]){const run=()=>pool.query(text,args);return {first:async()=>(await run()).rows[0]||null,all:async()=>({results:(await run()).rows}),run:async()=>({meta:{changes:(await run()).rowCount}})}}},
 botHosting:async(uid:number)=>botTables?(await pool.query("SELECT l.plan,l.runtime,l.state AS status,l.short AS server FROM shinchancloud.leases l JOIN shinchancloud.accounts a ON a.uid=l.uid WHERE a.panel=$1 ORDER BY l.plan LIMIT 20",[uid])).rows:[],
 renewBotFree:async(uid:number)=>botTables&&(await pool.query("UPDATE shinchancloud.leases l SET expires=CASE WHEN l.sid IS NULL THEN l.expires ELSE $2 END FROM shinchancloud.accounts a WHERE a.uid=l.uid AND a.panel=$1 AND l.plan='Free'",[uid,Math.floor(Date.now()/1000)+172800])).rowCount>0,
 };
}
