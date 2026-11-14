// node train.js [seconds] [workers=N] [nz=N] [eps=N] [league=0|1] [duel=N] [gate=0..1]
// Parallel self-play. Half the games are played against the previous brain (league), noise anneals as the
// brain matures, and the result is only saved if it did not regress against the brain it started from.
const fs=require('fs'),os=require('os'),{Worker,isMainThread,parentPort}=require('worker_threads'),CH=require('./engine.js'),F='brain/brain.aienc';
if(!isMainThread){let opp=null;parentPort.on('message',d=>{if(d.init){opp=d.opp;return}d.o.opp=opp;parentPort.postMessage(CH.batch(d.K,d.ms,d.o))})}
else(async()=>{
 const A=process.argv.slice(2),a={};for(const x of A){const m=x.match(/^(\w+)=(.*)$/);if(m)a[m[1]]=+m[2]}
 const secs=+A.find(x=>!x.includes('='))||60,W=Math.max(1,a.workers||(os.availableParallelism?os.availableParallelism():os.cpus().length));
 let K;
 if(fs.existsSync(F)){try{K=await CH.unpack(new Uint8Array(fs.readFileSync(F)),CH.PASS)}
  catch(e){console.error('Cannot read '+F+', refusing to overwrite it:',e.message);process.exit(1)}}
 else K=CH.fresh();
 const K0=structuredClone(K),g0=K.g,o={nz:a.nz??Math.max(8,25-K.g/2000),eps:a.eps??.05,sm:1,max:160,bk:100},T=Date.now()+secs*1000;
 await new Promise(res=>{let live=W;for(let i=0;i<W;i++){const w=new Worker(__filename);
  if(a.league!==0&&K0.g>0)w.postMessage({init:1,opp:K0});
  const go=()=>Date.now()<T?w.postMessage({K,ms:Math.min(1500,T-Date.now()),o}):(w.terminate(),--live||res());
  w.on('message',r=>{CH.merge(K,r,W);go()});w.on('error',e=>{console.error(e);process.exit(1)});go()}});
 const n=a.duel??60,eo={nz:12,eps:0,sm:1,max:160,bk:0},vsOld=K0.g?CH.duel(K,K0,n,eo):null,vsFresh=CH.duel(K,CH.fresh(),n,eo);
 K.hist.push({g:K.g,vsFresh,vsOld});K.hist=K.hist.slice(-100);
 console.log('workers',W,'games +'+(K.g-g0),'total',K.g,'| vs fresh',vsFresh.toFixed(2),'| vs previous',vsOld==null?'n/a':vsOld.toFixed(2));
 if(vsOld!=null&&vsOld<(a.gate??.4)){console.log('Regressed against the previous brain, keeping the old one.');return}
 fs.mkdirSync('brain',{recursive:true});fs.writeFileSync(F+'.tmp',await CH.pack(K,CH.PASS));fs.renameSync(F+'.tmp',F);
})();
