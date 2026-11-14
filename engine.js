(()=>{
const D={N:[-33,-31,-18,-14,14,18,31,33],K:[-17,-16,-15,-1,1,15,16,17],B:[-17,-15,15,17],R:[-16,-1,1,16]};D.Q=D.B.concat(D.R);
const SV=[0,100,320,330,500,900,0],CM=new Uint8Array(128).fill(15),PASS='ai-chess-brain-v1',C=globalThis.crypto||require('crypto').webcrypto;
CM[0]=13;CM[7]=14;CM[4]=12;CM[112]=7;CM[119]=11;CM[116]=3;
const IX=(s,f)=>s>0?((f>>4)<<3)|(f&7):((7-(f>>4))<<3)|(f&7);
const ev=(S,x,q,s)=>S.V[x-1]+S.P[(x-1)*64+IX(s,q)];
const VER=2,fresh=()=>({ver:VER,hist:[],g:0,w:0,d:0,l:0,V:[100,320,330,500,900,0],P:new Array(384).fill(0),op:{},mv:{},sac:{},miss:{},tag:{}});
const migrate=K=>{const f=fresh();for(const k in f)if(K[k]===undefined)K[k]=f[k];K.ver=VER;return K};
function start(){const b=new Int8Array(128),B=[4,2,3,5,6,3,2,4];for(let i=0;i<8;i++){b[i]=B[i];b[16+i]=1;b[96+i]=-1;b[112+i]=-B[i]}return{b,s:1,c:15,ep:-1,h:0,k:[4,116]}}
function att(b,s,c){
 for(const d of D.N){const t=s+d;if(!(t&136)&&b[t]===2*c)return 1}
 for(const d of D.K){const t=s+d;if(!(t&136)&&b[t]===6*c)return 1}
 for(const d of c>0?[-15,-17]:[15,17]){const t=s+d;if(!(t&136)&&b[t]===c)return 1}
 for(const d of D.B){let t=s+d;while(!(t&136)){const x=b[t]*c;if(x){if(x===3||x===5)return 1;break}t+=d}}
 for(const d of D.R){let t=s+d;while(!(t&136)){const x=b[t]*c;if(x){if(x===4||x===5)return 1;break}t+=d}}
 return 0}
function gen(p){const{b,s,c,ep}=p,o=[],R=s>0?7:0;
 for(let f=0;f<128;f++){if(f&136){f+=7;continue}const x=b[f]*s;if(x<=0)continue;
  if(x===1){const u=16*s,t=f+u;
   if(!b[t]){o.push(f|t<<7|((t>>4)===R?5<<14:0));if((f>>4)===(s>0?1:6)&&!b[t+u])o.push(f|(t+u)<<7|3<<17)}
   for(const d of[u-1,u+1]){const q=f+d;if(q&136)continue;if(b[q]*s<0)o.push(f|q<<7|((q>>4)===R?5<<14:0));else if(q===ep)o.push(f|q<<7|1<<17)}
  }else if(x===2||x===6){for(const d of x===2?D.N:D.K){const q=f+d;if(!(q&136)&&b[q]*s<=0)o.push(f|q<<7)}}
  else for(const d of x===3?D.B:x===4?D.R:D.Q){let q=f+d;while(!(q&136)){if(b[q]*s>0)break;o.push(f|q<<7);if(b[q])break;q+=d}}}
 const ob=s>0?0:112,kb=s>0?1:4;
 if(c&(kb|kb*2)&&!att(b,ob+4,-s)){
  if(c&kb&&!b[ob+5]&&!b[ob+6]&&!att(b,ob+5,-s))o.push((ob+4)|(ob+6)<<7|2<<17);
  if(c&kb*2&&!b[ob+1]&&!b[ob+2]&&!b[ob+3]&&!att(b,ob+3,-s))o.push((ob+4)|(ob+2)<<7|2<<17)}
 return o}
function mk(p,m){const b=p.b.slice(),f=m&127,t=m>>7&127,pr=m>>14&7,fl=m>>17,s=p.s,x=b[f],k=p.k.slice();let cap=Math.abs(b[t]);
 b[f]=0;b[t]=pr?pr*s:x;
 if(fl===1){b[t-16*s]=0;cap=1}
 if(fl===2){if(t>f){b[t-1]=b[t+1];b[t+1]=0}else{b[t+1]=b[t-2];b[t-2]=0}}
 if(x*s===6)k[s>0?0:1]=t;
 return{b,s:-s,c:p.c&CM[f]&CM[t],ep:fl===3?(f+t)>>1:-1,h:(x*s===1||cap)?0:p.h+1,k,cap}}
function legal(p){const r=[],i=p.s>0?0:1;for(const m of gen(p)){const q=mk(p,m);if(!att(q.b,q.k[i],-p.s))r.push([m,q])}return r}
const perft=(p,d)=>{if(!d)return 1;let n=0;for(const[,q]of legal(p))n+=perft(q,d-1);return n};
function pick(S,p,key,o){
 const L=legal(p);if(!L.length)return null;const s=p.s,i=s>0?0:1;let best=-1e9,bj=0,mj=-1;
 for(let j=0;j<L.length;j++){const[m,q]=L[j],f=m&127,t=m>>7&127,x=Math.abs(p.b[f]),pr=m>>14&7,c=q.cap,ck=att(q.b,q.k[1-i],s);
  if(ck&&!legal(q).length)mj=j;
  let sc=ev(S,x,t,s)-ev(S,x,f,s)+(c?ev(S,c,t,-s):0)+(pr?ev(S,5,t,s)-ev(S,1,t,s):0)+(ck?20:0)+Math.random()*o.nz;
  if(o.sm&&att(q.b,t,-s))sc-=att(q.b,t,s)?Math.max(0,S.V[x-1]-(c?S.V[c-1]:0)):S.V[x-1];
  if(key!=null){const e=S.op[key+(m&16383)+','];if(e){const n=e[0]+e[1]+e[2];sc+=o.bk*(((s>0?e[0]:e[2])+e[1]/2)/n-.5)*Math.min(1,n/5)+30/Math.sqrt(n+1)}else sc+=30}
  const w=S.mv[(x*7+c)*64+IX(s,t)];if(w&&w[0]>9)sc+=40*(w[1]-w[2])/w[0];
  if(sc>best){best=sc;bj=j}}
 const ch=Math.random()<o.eps?Math.random()*L.length|0:mj>=0?mj:bj;
 const id=j=>{const[m,q]=L[j];return(Math.abs(p.b[m&127])*7+q.cap)*64+IX(s,m>>7&127)};
 const[m,q]=L[ch],x=Math.abs(p.b[m&127]),c=q.cap,pr=m>>14&7,fl=m>>17,tg=[c?(SV[c]>SV[x]?'winning capture':'capture'):'quiet'];
 if(att(q.b,q.k[1-i],s))tg.push('check');if(pr)tg.push('promotion');if(fl===2)tg.push('castle');if(fl===1)tg.push('en passant');
 return{m,q,id:id(ch),tg,g:SV[c]+(pr?800:0),ms:mj>=0&&ch!==mj?id(mj):null}}
const up=(o,k,v)=>{const a=o[k]||(o[k]=v.map(()=>0));v.forEach((x,i)=>a[i]+=+x)};
function game(S,D,o){const O=o.opp,sd=Math.random()<.5?1:-1;let p=start(),key='',B=[],R=[],smp=[],mats=[0],mat=0,ply=0,res=0;
 for(;;){const r=pick(O&&p.s!==sd?O:S,p,ply<10?key:null,o);
  if(!r){res=att(p.b,p.k[p.s>0?0:1],-p.s)?-p.s:0;break}
  R.push({s:p.s,id:r.id,tg:r.tg,ms:r.ms});
  if(ply<10){key+=(r.m&16383)+',';B.push(key)}
  mat+=p.s*r.g;mats.push(mat);if(ply%3===1)smp.push(r.q.b);
  p=r.q;ply++;if(p.h>=100||ply>=o.max){res=Math.abs(mat)>=300?Math.sign(mat):0;break}}
 D.g++;D[res>0?'w':res<0?'l':'d']++;const ri=res>0?0:res<0?2:1,n=R.length;
 for(const k of B)up(D.op,k,[ri===0,ri===1,ri===2]);
 R.forEach((r,i)=>{const s=r.s,z=res*s,d=(mats[Math.min(i+2,n)]-mats[i])*s,a=[1,z>0,z<0,d];
  up(D.mv,r.id,a);for(const t of r.tg)up(D.tag,t,a);
  if(d<=-200)up(D.sac,r.id,[1,z>0,(mats[Math.min(i+4,n)]-mats[i])*s>=-100]);
  if(r.ms!=null)up(D.miss,r.ms,[1])});
 const lr=Math.max(.15,3000/(3000+S.g));for(const b of smp){let e=0;for(let f=0;f<128;f++){if(f&136){f+=7;continue}const x=b[f];if(x)e+=Math.sign(x)*ev(S,Math.abs(x),f,Math.sign(x))}
  const pr=Math.tanh(e/500),g=lr*.5*(res-pr)*(1-pr*pr);
  for(let f=0;f<128;f++){if(f&136){f+=7;continue}const x=b[f];if(!x)continue;const a=Math.abs(x),sg=Math.sign(x),j=(a-1)*64+IX(sg,f);
   S.P[j]=Math.max(-200,Math.min(200,S.P[j]+g*sg));if(a<6)S.V[a-1]=Math.max(30,Math.min(2000,S.V[a-1]+g*sg*.3))}}}
function batch(S,ms,o){const D={g:0,w:0,d:0,l:0,op:{},mv:{},sac:{},miss:{},tag:{}},V0=S.V.slice(),P0=S.P.slice(),t=Date.now();let n=0;
 while(Date.now()-t<ms){game(S,D,o);n++}
 return{D,n,dV:S.V.map((v,i)=>v-V0[i]),dP:S.P.map((v,i)=>v-P0[i])}}
function merge(K,R,N){const D=R.D;for(const k of['g','w','d','l'])K[k]+=D[k];
 for(const s of['op','mv','sac','miss','tag']){const a=K[s];for(const k in D[s]){const v=D[s][k],x=a[k];if(x)v.forEach((y,i)=>x[i]+=y);else a[k]=v}}
 R.dV.forEach((d,i)=>K.V[i]+=d/N);R.dP.forEach((d,i)=>K.P[i]+=d/N);
 for(let m=3;Object.keys(K.op).length>40000&&m<500;m*=2)for(const k in K.op){const e=K.op[k];if(e[0]+e[1]+e[2]<m)delete K.op[k]}}
// A vs B, n games, colours alternate, no learning. Returns A's score 0..1
function duel(A,B,n,o){let sc=0;for(let i=0;i<n;i++){const a=i&1?-1:1;let p=start(),r=0,mat=0;
 for(let ply=0;;ply++){const x=pick(p.s===a?A:B,p,null,o);if(!x){r=att(p.b,p.k[p.s>0?0:1],-p.s)?-p.s:0;break}
  mat+=p.s*x.g;p=x.q;if(p.h>=100||ply>=o.max){r=Math.abs(mat)>=300?Math.sign(mat):0;break}}
 sc+=r===0?.5:r===a?1:0}return sc/n}
async function ky(pw,salt){const m=await C.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);return C.subtle.deriveKey({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},m,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
const rd=async s=>new Uint8Array(await new Response(s).arrayBuffer());
async function pack(K,pw){const z=await rd(new Blob([JSON.stringify(K)]).stream().pipeThrough(new CompressionStream('deflate-raw'))),salt=C.getRandomValues(new Uint8Array(16)),iv=C.getRandomValues(new Uint8Array(12)),c=new Uint8Array(await C.subtle.encrypt({name:'AES-GCM',iv},await ky(pw,salt),z)),o=new Uint8Array(28+c.length);o.set(salt);o.set(iv,16);o.set(c,28);return o}
async function unpack(u,pw){const z=new Uint8Array(await C.subtle.decrypt({name:'AES-GCM',iv:u.slice(16,28)},await ky(pw,u.slice(0,16)),u.slice(28)));return migrate(JSON.parse(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()))}
const CH={fresh,batch,merge,pack,unpack,PASS,start,legal,perft,pick,duel,migrate,VER};
if(typeof module!=='undefined')module.exports=CH;else globalThis.CH=CH;
})();
