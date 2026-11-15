// node train.js [seconds] [workers=N] [nz=N] [eps=N] [league=0|1] [duel=N] [gate=0..1] [depth=N] [nodes=N] [mu=0..1] [instant=1] [log=1]
// instant=1: no search at all (headless, moves only as text, all rules enforced); collects statistics only. log=1 prints one finished game per batch.
// Parallel self-play with a real search (or, with instant=1, without one). Half the games are played against the previous brain (league). Every worker plays a few
// seconds with fixed numbers and sends back its statistics plus the summed gradient; the main thread applies one Adam step per batch.
// The result is only saved if it did not regress against the brain it started from.
const fs=require('fs'),os=require('os'),{Worker,isMainThread,parentPort}=require('worker_threads'),CH=require('./engine.js'),F='brain/brain.aienc';
if(!isMainThread){let opp=null;
 parentPort.on('message',d=>{if(d.init){opp=d.opp;return}
  if(d.duel){parentPort.postMessage({duel:CH.duel(d.A,d.B,d.n,d.o)});return}
  d.o.opp=opp;parentPort.postMessage(CH.batch(d.K,d.ms,d.o))})}
else(async()=>{
 const A=process.argv.slice(2),a={};for(const x of A){const m=x.match(/^(\w+)=(.*)$/);if(m)a[m[1]]=+m[2]}
 const secs=+A.find(x=>!x.includes('='))||60,W=Math.max(1,a.workers||(os.availableParallelism?os.availableParallelism():os.cpus().length));
 let K;
 if(fs.existsSync(F)){try{K=await CH.unpack(new Uint8Array(fs.readFileSync(F)),CH.PASS)}
  catch(e){console.error('Cannot read '+F+', refusing to overwrite it:',e.message);process.exit(1)}}
 else K=CH.fresh();
 const K0=structuredClone(K),g0=K.g,o=a.instant?{depth:0,nodes:0,nz:a.nz??40,eps:a.eps??.03,mu:.5,bk:100,max:200,nograd:1,st:1,log:a.log?1:0}:{depth:a.depth??3,nodes:a.nodes??2500,nz:a.nz??25,eps:a.eps??.05,mu:a.mu??.5,bk:100,max:200,st:1,log:a.log?1:0},T=Date.now()+secs*1000;
 const ws=[];
 await new Promise(res=>{let live=W;for(let i=0;i<W;i++){const w=new Worker(__filename);ws.push(w);
  if(a.league!==0&&K0.g>0)w.postMessage({init:1,opp:K0});
  const go=()=>Date.now()<T?w.postMessage({K,ms:Math.min(1000,T-Date.now()),o}):--live||res();
  w.on('message',r=>{if(r.duel!==undefined)return;CH.merge(K,r,W);if(a.log&&r.log){let s='';r.log.m.forEach((x,i)=>{s+=(i%2?'':(i/2+1)+'. ')+x+' '});console.log(s+({1:'1-0','-1':'0-1',0:'1/2-1/2'})[r.log.res])}go()});w.on('error',e=>{console.error(e);process.exit(1)});go()}});
 // the strength check runs in the same workers, in parallel
 const n=a.duel??60,eo={depth:4,nodes:3000,max:160},per=Math.max(2,Math.ceil(n/W/2)*2);
 const run=(X,Y)=>Promise.all(ws.map(w=>new Promise(r=>{w.once('message',m=>r(m.duel));w.postMessage({duel:1,A:X,B:Y,n:per,o:eo})}))).then(v=>v.reduce((s,x)=>s+x,0)/v.length);
 const vsOld=K0.g?await run(K,K0):null,vsFresh=await run(K,CH.fresh());ws.forEach(w=>w.terminate());
 K.hist.push({g:K.g,vsFresh,vsOld});K.hist=K.hist.slice(-100);
 console.log('workers',W,'games +'+(K.g-g0),'total',K.g,'| vs untrained',vsFresh.toFixed(2),'| vs previous',vsOld==null?'n/a':vsOld.toFixed(2));
 if(vsOld!=null&&vsOld<(a.gate??.4)){console.log('Regressed against the previous brain, keeping the old one.');return}
 fs.mkdirSync('brain',{recursive:true});fs.writeFileSync(F+'.tmp',await CH.pack(K,CH.PASS));fs.renameSync(F+'.tmp',F);
})();
