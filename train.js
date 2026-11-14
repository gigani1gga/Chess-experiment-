// node train.js [seconds] - headless self-play, saves brain/brain.aienc
const fs=require('fs'),CH=require('./engine.js'),F='brain/brain.aienc';
(async()=>{let K;try{K=await CH.unpack(new Uint8Array(fs.readFileSync(F)),CH.PASS)}catch{K=CH.fresh()}
 const T=+(process.argv[2]||60)*1000,t=Date.now(),g=K.g,o={nz:25,eps:.05,sm:1,max:160,bk:100};
 while(Date.now()-t<T)CH.merge(K,CH.batch(structuredClone(K),1500,o),1);
 fs.mkdirSync('brain',{recursive:true});fs.writeFileSync(F,await CH.pack(K,CH.PASS));console.log('games',K.g-g,'total',K.g)})();
