// Chess AI Lab engine. One file, used by the page (inlined), by the browser workers and by train.js.
//  - Real search: iterative deepening, alpha-beta/PVS, quiescence, transposition table, null move, LMR, killers, history.
//  - The evaluation is linear in a set of learned numbers (K.V piece values, K.P middlegame and K.W endgame
//    piece-square tables, K.X a few scalar bonuses) that sit on top of fixed classical priors. Training only has to learn the
//    difference from sensible chess knowledge, which is much faster than learning from zero.
(()=>{
'use strict';
const PASS='ai-chess-brain-v1',C=globalThis.crypto||require('crypto').webcrypto,VER=3;
const D={N:[-33,-31,-18,-14,14,18,31,33],K:[-17,-16,-15,-1,1,15,16,17],B:[-17,-15,15,17],R:[-16,-1,1,16]};D.Q=D.B.concat(D.R);
const DN=D.N,DKG=D.K,DB=D.B,DR=D.R,DQ=[-17,-15,15,17,-16,-1,1,16];
const SV=[0,100,320,330,500,900,0],PW=[0,0,1,1,2,4,0],MATE=30000,INF=32000;
const CM=new Uint8Array(128).fill(15);CM[0]=13;CM[7]=14;CM[4]=12;CM[112]=7;CM[119]=11;CM[116]=3;
// own-side index of a square: rank 0 is the owner's back rank (so one table serves both colours)
const IX=(s,f)=>s>0?((f>>4)<<3)|(f&7):((7-(f>>4))<<3)|(f&7);
// ---- fixed priors (the learned tables are added on top of these) ----
const BMG=[],BEG=[];
(()=>{const ct=(r,c)=>7-Math.abs(r-3.5)-Math.abs(c-3.5),FB=[-6,-2,3,8,8,3,-2,-6],KC=[8,22,12,-8,-8,2,28,10];
 for(let a=1;a<=6;a++){BMG[a]=new Int16Array(64);BEG[a]=new Int16Array(64)}
 for(let r=0;r<8;r++)for(let c=0;c<8;c++){const j=r*8+c,e=ct(r,c);
  BMG[1][j]=[0,0,2,6,14,28,46,0][r]+(r>=2&&r<=5?FB[c]:0);BEG[1][j]=[0,0,6,14,28,50,85,0][r];
  BMG[2][j]=Math.round(8*e-24);BEG[2][j]=Math.round(5.5*e-17);
  BMG[3][j]=Math.round(4*e-10-(r===0?4:0));BEG[3][j]=Math.round(3*e-8);
  BMG[4][j]=(r===6?14:0)+(c===3||c===4?4:0);BEG[4][j]=r===6?8:0;
  BMG[5][j]=Math.round(2*e-6);BEG[5][j]=Math.round(3*e-8);
  BMG[6][j]=r===0?KC[c]:-30*r;BEG[6][j]=Math.round(8*e-16)}})();
// scalar bonuses: [bishop pair, doubled pawn, isolated pawn, passed pawn per rank (endgame), king pawn shield, tempo]
const XB=[30,12,12,0,10,10],PBM=[0,0,5,10,20,35,60,0],PBE=[0,0,10,20,40,70,120,0];
const NP=5+384+384+6,OV=0,OP=5,OW=389,OX=773;   // layout of the flat parameter vector
const fresh=()=>({ver:VER,hist:[],g:0,w:0,d:0,l:0,pl:0,V:[100,320,330,500,900,0],P:new Array(384).fill(0),W:new Array(384).fill(0),X:new Array(6).fill(0),opt:null,pat:{},pred:{},pa:[0,0],op:{},mv:{},sac:{},miss:{},tag:{},pt2:{}});
// Old brains (ver 1/2) keep all their statistics. Their piece-square numbers were learned while the engine only looked one move ahead,
// so they are reset to the new, much better starting point.
const migrate=K=>{const old=K.ver<3,f=fresh();for(const k in f)if(K[k]===undefined)K[k]=f[k];
 if(old){K.V=f.V;K.P=f.P;K.W=f.W;K.X=f.X;K.opt=null}
 K.ver=VER;return K};
const flat=K=>{const t=new Float64Array(NP);for(let i=0;i<5;i++)t[OV+i]=K.V[i];for(let i=0;i<384;i++){t[OP+i]=K.P[i];t[OW+i]=K.W[i]}for(let i=0;i<6;i++)t[OX+i]=K.X[i];return t};
const unflat=(K,t)=>{for(let i=0;i<5;i++)K.V[i]=t[OV+i];for(let i=0;i<384;i++){K.P[i]=t[OP+i];K.W[i]=t[OW+i]}for(let i=0;i<6;i++)K.X[i]=t[OX+i]};
// ---- brain file: deflate + AES-GCM (unchanged format) ----
async function ky(pw,salt){const m=await C.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);return C.subtle.deriveKey({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},m,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
const rd=async s=>new Uint8Array(await new Response(s).arrayBuffer());
async function pack(K,pw){const z=await rd(new Blob([JSON.stringify(K)]).stream().pipeThrough(new CompressionStream('deflate-raw'))),salt=C.getRandomValues(new Uint8Array(16)),iv=C.getRandomValues(new Uint8Array(12)),c=new Uint8Array(await C.subtle.encrypt({name:'AES-GCM',iv},await ky(pw,salt),z)),o=new Uint8Array(28+c.length);o.set(salt);o.set(iv,16);o.set(c,28);return o}
async function unpack(u,pw){const z=new Uint8Array(await C.subtle.decrypt({name:'AES-GCM',iv:u.slice(16,28)},await ky(pw,u.slice(0,16)),u.slice(28)));return migrate(JSON.parse(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()))}
function start(){const b=new Int8Array(128),B=[4,2,3,5,6,3,2,4];for(let i=0;i<8;i++){b[i]=B[i];b[16+i]=1;b[96+i]=-1;b[112+i]=-B[i]}return{b,s:1,c:15,ep:-1,h:0,k:[4,116]}}
// deterministic random numbers (zobrist keys, so every thread agrees on hashes)
let zs=0x9E3779B9;const rnd=()=>{zs^=zs<<13;zs^=zs>>>17;zs^=zs<<5;return zs|0};
const ZL=new Int32Array(14*128),ZH=new Int32Array(14*128),ZCL=new Int32Array(16),ZCH=new Int32Array(16),ZEL=new Int32Array(8),ZEH=new Int32Array(8);
for(let i=0;i<14*128;i++){ZL[i]=rnd();ZH[i]=rnd()}for(let i=0;i<16;i++){ZCL[i]=rnd();ZCH[i]=rnd()}for(let i=0;i<8;i++){ZEL[i]=rnd();ZEH[i]=rnd()}
const SL=rnd(),SH=rnd();
// A fine signature is seen rarely. Its coarse parent (same without the destination square) is seen often. The estimate for a move is the fine
// record shrunk toward the coarse one (hierarchical smoothing), so a situation never seen before is still judged by its kind, and a rare one is not
// over-trusted. Result in [-1,1]: expected (win - loss) of the mover in that pattern.
const coarse=k=>{const e=k%5;k=(k-e)/5;const ph=k%4;k=(k-ph)/4;const ad=k%4;k=(k-ad)/4;const xc=(k-k%64)/64;return((xc*4+ad)*4+ph)*5+e};
const SHR=6;
function patEst(M,k){const a=M.pat[k],c=M.pt2&&M.pt2[coarse(k)],mc=c?(c[1]-c[2])/(c[0]+2*SHR):0;
 return a?(a[1]-a[2]+SHR*mc)/(a[0]+SHR):mc}
// ======================================================================================================
// Engine(K,o): one searcher with its own board, transposition table and evaluation tables built from brain K
// (K may be null: classical evaluation without any learned numbers).
// ======================================================================================================
function Engine(K,o){o=o||{};
 const TS=1<<(o.tt||17),TM=TS-1,N=2048,MAXP=128;
 const MG=new Int32Array(14*128),EG=new Int32Array(14*128),xv=i=>XB[i]+(K?K.X[i]:0);
 for(let a=1;a<=6;a++)for(let q=0;q<128;q++){if(q&136)continue;
  for(const sg of[1,-1]){const j=IX(sg,q),v=a<6&&K?K.V[a-1]:SV[a];
   MG[(sg*a+6)*128+q]=sg*(v+(K?K.P[(a-1)*64+j]:0)+BMG[a][j]);EG[(sg*a+6)*128+q]=sg*(v+(K?K.W[(a-1)*64+j]:0)+BEG[a][j])}}
 // position state
 const b=new Int8Array(128),cnt=new Int8Array(14),HL=new Int32Array(N),HH=new Int32Array(N);
 let s=1,c=15,ep=-1,h=0,wk=4,bk=116,lo=0,hi=0,plo=0,phi=0,mg=0,eg=0,ph=0,n=0,n0=0;
 const sMv=new Int32Array(N),sCap=new Int8Array(N),sC=new Uint8Array(N),sEp=new Int16Array(N),sH=new Int16Array(N),sK=new Int16Array(2*N),
  sLo=new Int32Array(N),sHi=new Int32Array(N),sPl=new Int32Array(N),sPh=new Int32Array(N),sMg=new Int32Array(N),sEg=new Int32Array(N),sPp=new Int8Array(N);
 const rm=(x,q)=>{const i=(x+6)*128+q;lo^=ZL[i];hi^=ZH[i];mg-=MG[i];eg-=EG[i];const a=x<0?-x:x;ph-=PW[a];cnt[x+6]--;if(a===1){plo^=ZL[i];phi^=ZH[i]}};
 const ad=(x,q)=>{const i=(x+6)*128+q;lo^=ZL[i];hi^=ZH[i];mg+=MG[i];eg+=EG[i];const a=x<0?-x:x;ph+=PW[a];cnt[x+6]++;if(a===1){plo^=ZL[i];phi^=ZH[i]}};
 function att(q,col){let t;
  for(let i=0;i<8;i++){t=q+DN[i];if(!(t&136)&&b[t]===2*col)return 1}
  for(let i=0;i<8;i++){t=q+DKG[i];if(!(t&136)&&b[t]===6*col)return 1}
  t=q-16*col+1;if(!(t&136)&&b[t]===col)return 1;t=q-16*col-1;if(!(t&136)&&b[t]===col)return 1;
  for(let i=0;i<4;i++){const d=DB[i];t=q+d;while(!(t&136)){const x=b[t]*col;if(x){if(x===3||x===5)return 1;break}t+=d}}
  for(let i=0;i<4;i++){const d=DR[i];t=q+d;while(!(t&136)){const x=b[t]*col;if(x){if(x===4||x===5)return 1;break}t+=d}}
  return 0}
 const inCheck=()=>att(s>0?wk:bk,-s);
 const reset=()=>{lo=hi=plo=phi=mg=eg=ph=0;cnt.fill(0);
  for(let q=0;q<128;q++){if(q&136){q+=7;continue}const x=b[q];if(x)ad(x,q)}
  lo^=ZCL[c];hi^=ZCH[c];if(ep>=0){lo^=ZEL[ep&7];hi^=ZEH[ep&7]}if(s<0){lo^=SL;hi^=SH}};
 // load a position {b,s,c,ep,h}; rep = flat [lo,hi,lo,hi...] hashes of earlier game positions (for repetition detection)
 function set(p,rep){b.set(p.b);s=p.s;c=p.c;ep=p.ep;h=p.h;wk=bk=-1;
  for(let q=0;q<128;q++){if(q&136){q+=7;continue}if(b[q]===6)wk=q;else if(b[q]===-6)bk=q}
  reset();rep=rep&&rep.length>2000?rep.slice(rep.length-2000):rep;n=rep?rep.length>>1:0;
  for(let i=0;i<n;i++){HL[i]=rep[2*i];HH[i]=rep[2*i+1]}HL[n]=lo;HH[n]=hi;n0=n}
 const snap=()=>({b:b.slice(),s,c,ep,h,k:[wk,bk]});
 function make(m){const f=m&127,t=(m>>7)&127,pr=(m>>14)&7,fl=m>>17,x=b[f],cap=b[t],a=x*s;
  sMv[n]=m;sCap[n]=cap;sC[n]=c;sEp[n]=ep;sH[n]=h;sK[2*n]=wk;sK[2*n+1]=bk;sLo[n]=lo;sHi[n]=hi;sPl[n]=plo;sPh[n]=phi;sMg[n]=mg;sEg[n]=eg;sPp[n]=ph;
  if(ep>=0){lo^=ZEL[ep&7];hi^=ZEH[ep&7]}lo^=ZCL[c];hi^=ZCH[c];
  rm(x,f);b[f]=0;if(cap)rm(cap,t);
  if(fl===1){const q=t-16*s;rm(-s,q);b[q]=0}
  const nx=pr?pr*s:x;ad(nx,t);b[t]=nx;
  if(fl===2){let rf,rt;if(t>f){rf=t+1;rt=t-1}else{rf=t-2;rt=t+1}const r=4*s;rm(r,rf);b[rf]=0;ad(r,rt);b[rt]=r}
  if(a===6){if(s>0)wk=t;else bk=t}
  c&=CM[f]&CM[t];ep=fl===3?(f+t)>>1:-1;h=a===1||cap?0:h+1;
  lo^=ZCL[c];hi^=ZCH[c];if(ep>=0){lo^=ZEL[ep&7];hi^=ZEH[ep&7]}
  s=-s;lo^=SL;hi^=SH;n++;HL[n]=lo;HH[n]=hi}
 function unmake(){n--;const m=sMv[n],f=m&127,t=(m>>7)&127,pr=(m>>14)&7,fl=m>>17,cap=sCap[n];s=-s;
  c=sC[n];ep=sEp[n];h=sH[n];wk=sK[2*n];bk=sK[2*n+1];lo=sLo[n];hi=sHi[n];plo=sPl[n];phi=sPh[n];mg=sMg[n];eg=sEg[n];ph=sPp[n];
  const nx=b[t],x=pr?s:nx;if(pr){cnt[nx+6]--;cnt[x+6]++}
  b[f]=x;b[t]=cap;if(cap)cnt[cap+6]++;
  if(fl===1){b[t]=0;b[t-16*s]=-s;cnt[-s+6]++}
  if(fl===2){let rf,rt;if(t>f){rf=t+1;rt=t-1}else{rf=t-2;rt=t+1}b[rf]=4*s;b[rt]=0}}
 function makeNull(){sMv[n]=0;sEp[n]=ep;sH[n]=h;sLo[n]=lo;sHi[n]=hi;if(ep>=0){lo^=ZEL[ep&7];hi^=ZEH[ep&7]}ep=-1;h++;s=-s;lo^=SL;hi^=SH;n++;HL[n]=lo;HH[n]=hi}
 function unmakeNull(){n--;s=-s;ep=sEp[n];h=sH[n];lo=sLo[n];hi=sHi[n]}
 // pseudo-legal moves into MB[o..], returns end index. caps: captures and queen promotions only
 const MB=new Int32Array(MAXP*256),MS=new Int32Array(MAXP*256);
 function gen(o,caps){let k=o;const R=s>0?7:0;
  for(let f=0;f<128;f++){if(f&136){f+=7;continue}const x=b[f]*s;if(x<=0)continue;
   if(x===1){const u=16*s,t=f+u;
    if(!b[t]){if((t>>4)===R){MB[k++]=f|t<<7|5<<14;if(!caps){MB[k++]=f|t<<7|4<<14;MB[k++]=f|t<<7|3<<14;MB[k++]=f|t<<7|2<<14}}
     else if(!caps){MB[k++]=f|t<<7;if((f>>4)===(s>0?1:6)&&!b[t+u])MB[k++]=f|(t+u)<<7|3<<17}}
    for(let di=-1;di<2;di+=2){const q=f+u+di;if(q&136)continue;
     if(b[q]*s<0){if((q>>4)===R){MB[k++]=f|q<<7|5<<14;if(!caps){MB[k++]=f|q<<7|4<<14;MB[k++]=f|q<<7|3<<14;MB[k++]=f|q<<7|2<<14}}else MB[k++]=f|q<<7}
     else if(q===ep)MB[k++]=f|q<<7|1<<17}
   }else if(x===2||x===6){const dd=x===2?DN:DKG;for(let i=0;i<8;i++){const q=f+dd[i];if(q&136)continue;const y=b[q]*s;if(y<0||(y===0&&!caps))MB[k++]=f|q<<7}}
   else{const dd=x===3?DB:x===4?DR:DQ;for(let i=0,nd=x===3||x===4?4:8;i<nd;i++){const d=dd[i];let q=f+d;while(!(q&136)){const y=b[q]*s;if(y>0)break;if(y<0){MB[k++]=f|q<<7;break}if(!caps)MB[k++]=f|q<<7;q+=d}}}}
  if(!caps){const ob=s>0?0:112,kb=s>0?1:4;
   if(c&(kb|kb*2)&&b[ob+4]===6*s&&!att(ob+4,-s)){
    if(c&kb&&!b[ob+5]&&!b[ob+6]&&b[ob+7]===4*s&&!att(ob+5,-s))MB[k++]=(ob+4)|(ob+6)<<7|2<<17;
    if(c&kb*2&&!b[ob+1]&&!b[ob+2]&&!b[ob+3]&&b[ob]===4*s&&!att(ob+3,-s))MB[k++]=(ob+4)|(ob+2)<<7|2<<17}}
  return k}
 const kingAfter=()=>s>0?bk:wk;               // king of the side that just moved
 // A pseudo-legal move can only be illegal if we are in check, the king moves, it is en passant, or the piece stands on a line through the king.
 const risky=(f,chk,fl)=>{if(chk||fl===1)return 1;const k=s>0?wk:bk,dr=(f>>4)-(k>>4),df=(f&7)-(k&7);return f===k||dr===0||df===0||dr===df||dr===-df}
 function legalMoves(){const e=gen(0,false),r=[],chk=inCheck();for(let i=0;i<e;i++){const m=MB[i],rk=risky(m&127,chk,m>>17);make(m);if(!rk||!att(kingAfter(),s))r.push(m);unmake()}return r}
 function perft(d,ply){ply=ply|0;if(!d)return 1;const o=ply*256,e=gen(o,false),chk=inCheck();let r=0;
  for(let i=o;i<e;i++){const rk=risky(MB[i]&127,chk,MB[i]>>17);make(MB[i]);if(!rk||!att(kingAfter(),s))r+=d===1?1:perft(d-1,ply+1);unmake()}return r}
 
 // ---- evaluation (side-to-move point of view). Must stay in sync with grad() further down. ----
 const PKL=new Int32Array(8192),PKH=new Int32Array(8192),PMG=new Int32Array(8192),PEG=new Int32Array(8192),F=new Int32Array(5);
 const dp=xv(1),ip=xv(2),xs=xv(3),bp=xv(0),ks=xv(4),tp=xv(5);
 const shield=(k,col)=>{if(col>0?(k>>4)>1:(k>>4)<6)return 0;let m=0;for(let d=-1;d<2;d++){const q=k+16*col+d;if(!(q&136)&&b[q]===col)m++}return m};
 function evaluate(){const p=ph>24?24:ph,i=plo&8191;let pm,pe;
  if(PKL[i]===plo&&PKH[i]===phi){pm=PMG[i];pe=PEG[i]}
  else{pawnFeat(b,F);const base=-dp*F[0]-ip*F[1];pm=base+F[3];pe=base+F[4]+xs*F[2];PKL[i]=plo;PKH[i]=phi;PMG[i]=pm;PEG[i]=pe}
  let sc=((mg+pm)*p+(eg+pe)*(24-p))/24;
  if(cnt[9]>1)sc+=bp;if(cnt[3]>1)sc-=bp;
  sc+=ks*p/24*(shield(wk,1)-shield(bk,-1));
  return Math.round(s>0?sc:-sc)+tp}
 // king+one minor piece (or less) can never mate
 const insuf=()=>!(cnt[7]|cnt[5]|cnt[10]|cnt[2]|cnt[11]|cnt[1])&&cnt[8]+cnt[4]+cnt[9]+cnt[3]<2;
 const npm=()=>s>0?cnt[8]+cnt[9]+cnt[10]+cnt[11]>0:cnt[4]+cnt[3]+cnt[2]+cnt[1]>0;
 // ---- search ----
 const tkL=new Int32Array(TS),tkH=new Int32Array(TS),tmv=new Int32Array(TS),tsc=new Int16Array(TS),tdp=new Int8Array(TS),tfl=new Uint8Array(TS),tag=new Uint8Array(TS);
 let MD=K,age=1,nodes=0,stop=0,canStop=0,tEnd=0,maxN=0,rootM=0;
 const killer=new Int32Array(MAXP*2),hist=new Int32Array(2*16384);
 const clearTT=()=>{age=age>=254?1:age+1;if(age===1)tag.fill(0);hist.fill(0);killer.fill(0)};
 function order(o,e,ttm,ply){for(let i=o;i<e;i++){const m=MB[i],f=m&127,t=(m>>7)&127,x=b[f]<0?-b[f]:b[f],v=b[t]<0?-b[t]:b[t],pr=(m>>14)&7;let sc;
  if(m===ttm)sc=1e8;else if(v||(m>>17)===1||pr){sc=1e6+(v||1)*16-x+(pr===5?800:pr?-500:0)}
  else if(m===killer[2*ply])sc=9e5;else if(m===killer[2*ply+1])sc=8e5;else sc=hist[(s>0?0:16384)+f*128+t];
  MS[i]=sc}}
 const pickNext=(i,e)=>{let bi=i,bs=MS[i];for(let j=i+1;j<e;j++)if(MS[j]>bs){bs=MS[j];bi=j}
  if(bi!==i){const m=MB[i],sc=MS[i];MB[i]=MB[bi];MS[i]=bs;MB[bi]=m;MS[bi]=sc}return MB[i]};
 const tick=()=>{if(canStop&&((nodes&1023)===0)&&(Date.now()>tEnd||nodes>maxN))stop=1};
 function qs(alpha,beta,ply){nodes++;tick();if(stop)return 0;
  if(h>=100||insuf())return 0;if(ply>=MAXP-2)return evaluate();
  const chk=inCheck();let best=-INF;
  if(!chk){best=evaluate();if(best>=beta)return best;if(best>alpha)alpha=best}
  const o=ply*256,e=gen(o,!chk);order(o,e,0,ply);let legal=0;
  for(let i=o;i<e;i++){const m=pickNext(i,e),t=(m>>7)&127,pr=(m>>14)&7,vic=b[t]<0?-b[t]:b[t]||1;
   if(!chk&&!pr&&best+SV[vic]+200<=alpha)continue;
   const rk=risky(m&127,chk,m>>17);make(m);if(rk&&att(kingAfter(),s)){unmake();continue}legal++;
   if(!chk&&!pr){const a=b[t]<0?-b[t]:b[t];if(SV[a]>SV[vic]+50&&att(t,s)){unmake();continue}}
   const sc=-qs(-beta,-alpha,ply+1);unmake();if(stop)return 0;
   if(sc>best){best=sc;if(sc>alpha){alpha=sc;if(sc>=beta)break}}}
  if(chk&&!legal)return -MATE+ply;return best}
 function ab(d,alpha,beta,ply,nul){nodes++;tick();if(stop)return 0;
  const pv=beta-alpha>1;
  if(ply>0){if(h>=100||insuf())return 0;for(let i=n-2;i>=n-h&&i>=0;i-=2)if(HL[i]===lo&&HH[i]===hi)return 0;
   if(alpha<-MATE+ply)alpha=-MATE+ply;if(beta>MATE-ply-1)beta=MATE-ply-1;if(alpha>=beta)return alpha}
  if(ply>=MAXP-2)return evaluate();
  const chk=inCheck();if(chk)d++;if(d<=0)return qs(alpha,beta,ply);
  let ttm=0;const ti=lo&TM;
  if(tkL[ti]===lo&&tkH[ti]===hi&&tag[ti]===age){ttm=tmv[ti];
   if(ply>0&&!pv&&tdp[ti]>=d){let sc=tsc[ti];if(sc>MATE-200)sc-=ply;else if(sc<-MATE+200)sc+=ply;const fl=tfl[ti];
    if(fl===1||(fl===2&&sc>=beta)||(fl===3&&sc<=alpha))return sc}}
  const ev=chk?0:evaluate();
  if(!pv&&!chk&&beta>-MATE+200&&beta<MATE-200){
   if(d<=3&&ev-110*d>=beta)return ev;
   if(nul&&d>=3&&ev>=beta&&npm()){makeNull();const sc=-ab(d-3-(d>6?1:0),-beta,-beta+1,ply+1,false);unmakeNull();if(stop)return 0;if(sc>=beta)return sc>MATE-200?beta:sc}}
  const o=ply*256,e=gen(o,false);order(o,e,ttm,ply);
  let best=-INF,bm=0,legal=0;const a0=alpha;
  for(let i=o;i<e;i++){const m=pickNext(i,e),f=m&127,t=(m>>7)&127,quiet=!(b[t]||(m>>17)===1||(m>>14)&7);
   const rk=risky(f,chk,m>>17);make(m);if(rk&&att(kingAfter(),s)){unmake();continue}legal++;
   const gives=quiet&&!chk&&att(s>0?wk:bk,-s);
   if(!pv&&!chk&&quiet&&!gives&&d<=2&&legal>1&&ev+100+120*d<=alpha){unmake();continue}
   let sc;
   if(legal===1)sc=-ab(d-1,-beta,-alpha,ply+1,true);
   else{const r=d>=3&&legal>3&&quiet&&!chk&&!gives?(legal>8?2:1):0;
    sc=-ab(d-1-r,-alpha-1,-alpha,ply+1,true);
    if(sc>alpha&&r)sc=-ab(d-1,-alpha-1,-alpha,ply+1,true);
    if(sc>alpha&&sc<beta)sc=-ab(d-1,-beta,-alpha,ply+1,true)}
   unmake();if(stop)return 0;
   if(sc>best){best=sc;bm=m;if(sc>alpha){alpha=sc;if(ply===0)rootM=m;
    if(alpha>=beta){if(quiet){if(killer[2*ply]!==m){killer[2*ply+1]=killer[2*ply];killer[2*ply]=m}const k=(s>0?0:16384)+f*128+t;hist[k]+=d*d;if(hist[k]>1e6)hist.fill(0)}break}}}}
  if(!legal)return chk?-MATE+ply:0;
  if(!stop){tkL[ti]=lo;tkH[ti]=hi;tmv[ti]=bm;tdp[ti]=d>100?100:d;tag[ti]=age;tfl[ti]=best>=beta?2:best>a0?1:3;
   tsc[ti]=best>MATE-200?best+ply:best<-MATE+200?best-ply:best}
  return best}
  // Context signature of a move: piece, captured piece, destination (from the mover's side), attacked/defended there, game phase, who is ahead.
 // Results are remembered per signature, so a move is judged by the kind of situation it was played in, not by the move alone.
 function ctx(m){const f=m&127,t=(m>>7)&127,x=b[f]<0?-b[f]:b[f],cap=(m>>17)===1?1:(b[t]<0?-b[t]:b[t]),sd=s,ev=evaluate();
  make(m);const at=att(t,s)?1:0,df=att(t,-s)?1:0;unmake();
  return((((x*7+cap)*64+IX(sd,t))*4+at*2+df)*4+Math.min(3,ph>>3))*5+Math.max(-2,Math.min(2,Math.round(ev/150)))+2}
 // Second look at the root moves: add what past games say about the move's pattern, and what the opponent usually answers.
 function rerank(L,dd,o,bm){const rd=Math.max(1,Math.min(dd-2,o.rd||3));stop=0;canStop=1;nodes=0;maxN=(o.nodes||1e12)*.6;tEnd=Date.now()+Math.max(80,(o.ms||1000)*.3);
  // The search's best move goes first. Every other move is tested against the window [top-50, inf): one that cannot get within 50cp
  // of the best fails low almost immediately (alpha-beta) instead of being searched with a full window.
  const V=new Array(L.length).fill(-INF);let top=-INF;const bi0=Math.max(0,L.indexOf(bm));
  for(let j=0;j<L.length;j++){const i=j===0?bi0:j===bi0?0:j,m=L[i];make(m);
   const v=-ab(rd,-INF,top>-INF?-(top-51):INF,1,true);unmake();if(stop)return{m:bm,pr:0,pf:0};
   if(v>top-51)V[i]=v;if(v>top)top=v}
  let bs=-INF,bi=-1,bpr=0,bpf=0;
  for(let i=0;i<L.length;i++){if(V[i]<top-50)continue;const m=L[i];let adj=0,pr=0,pf=0;
   adj+=Math.round(45*patEst(MD,ctx(m)));
   make(m);const pd=MD.pred&&MD.pred[lo>>>0];
   if(pd){let tot=0,mv=0,bc=0;for(const k in pd){tot+=pd[k];if(pd[k]>bc){bc=pd[k];mv=+k}}
    if(tot>=3&&bc/tot>=.4){const e=gen(256,false);let ok=0;for(let j=256;j<e;j++)if(MB[j]===mv){ok=1;break}
     if(ok){make(mv);if(att(kingAfter(),s))unmake();else{const u=ab(rd,V[i],V[i]+200,2,true);unmake();
      if(!stop){pr=mv;pf=bc/tot;if(u>V[i])adj+=Math.min(120,Math.round(.6*pf*(u-V[i])))}}}}}
   unmake();if(stop)return{m:bm,pr:0,pf:0};
   if(V[i]+adj>bs){bs=V[i]+adj;bi=i;bpr=pr;bpf=pf}}
  return bi<0?{m:bm,pr:0,pf:0}:{m:L[bi],pr:bpr,pf:bpf}}
 // Search the loaded position. o: {ms, depth, nodes}. Returns {m, score (side to move, centipawns), depth, nodes}
 // Instant move: no tree search. Judges each legal move by the static evaluation after it, minus the piece if it lands where it can just be taken.
 // A move that mates is always chosen. Used by the headless "Instant" learning mode.
 function quick(L,nz){let best=-1e9,bm=L[0];
  for(let i=0;i<L.length;i++){const m=L[i],t=(m>>7)&127,x=b[m&127]<0?-b[m&127]:b[m&127],cp=(m>>17)===1?1:(b[t]<0?-b[t]:b[t]);
   make(m);let v=-evaluate();
   if(inCheck()){if(!legalMoves().length)v=MATE}
   else if(att(t,s)){if(!att(t,-s))v-=SV[x];else if(SV[x]>SV[cp]+50)v-=SV[x]-SV[cp]}
   unmake();const w=v+Math.random()*nz;if(w>best){best=w;bm=m;var bv=v}}
  return{m:bm,score:bv}}
 function search(o){o=o||{};const t0=Date.now(),ms=o.ms||1000;nodes=0;stop=0;canStop=0;tEnd=t0+ms;maxN=o.nodes||1e12;killer.fill(0);
  const L=o.L||legalMoves();if(!L.length)return{m:0,score:inCheck()?-MATE:0,depth:0,nodes:0};
  let bm=L[0],score=0,dd=0;
  for(let d=1;d<=(o.depth||64);d++){rootM=0;const sc=ab(d,-INF,INF,0,true);
   if(rootM)bm=rootM;if(stop)break;score=sc;dd=d;canStop=1;
   if(Math.abs(sc)>MATE-200&&d>MATE-Math.abs(sc))break;
   if(Date.now()-t0>ms*.45||L.length===1&&d>=4)break}
  let pr=0,pf=0;
  if(o.rank&&MD&&MD.pat&&L.length>1&&dd>=2){const q=rerank(L,dd,o,bm);bm=q.m;pr=q.pr;pf=q.pf}
  return{m:bm,score,depth:dd,nodes,pr,pf}}
 const repCount=()=>{let r=0;for(let i=n;i>=0;i--)if(HL[i]===lo&&HH[i]===hi)r++;return r};
 return{peek:q=>b[q],quick,ctx,setModel:k=>{MD=k},set,snap,make,unmake,legalMoves,perft,search,clearTT,evaluate,inCheck,att,insuf,repCount,qsearch:()=>{stop=0;canStop=0;return qs(-INF,INF,0)},
  mated:()=>inCheck()?-s:0,   // winner's sign when the side to move has no legal move (0 = stalemate)
 get hash(){return[lo,hi]},get side(){return s},get ply(){return n-n0},get half(){return h}}}
// ---- move text: standard algebraic notation (O-O, O-O-O, exd6 e.p., e8=Q+, Nbd7, #) ----
const SQN=q=>'abcdefgh'[q&7]+((q>>4)+1);
function san(E,m,L){const f=m&127,t=(m>>7)&127,pr=(m>>14)&7,fl=m>>17,x=Math.abs(E.peek(f));let r;
 if(fl===2)r=t>f?'O-O':'O-O-O';
 else{const cap=fl===1||E.peek(t)!==0;
  if(x===1)r=(cap?'abcdefgh'[f&7]+'x':'')+SQN(t)+(pr?'='+'NBRQ'[pr-2]:'')+(fl===1?' e.p.':'');
  else{let fi=0,ra=0,am=0;for(const o of L){if(o===m||((o>>7)&127)!==t||Math.abs(E.peek(o&127))!==x)continue;am=1;if((o&7)===(f&7))fi=1;if(((o&127)>>4)===(f>>4))ra=1}
   r='  NBRQK'[x]+(am?(!fi?'abcdefgh'[f&7]:!ra?String((f>>4)+1):SQN(f)):'')+(cap?'x':'')+SQN(t)}}
 E.make(m);if(E.inCheck())r+=E.legalMoves().length?'+':'#';E.unmake();return r}
// ---- pawn structure features (shared by the evaluation and the gradient) ----
const _wc=new Int8Array(10),_bc=new Int8Array(10),_wm=new Int8Array(10),_bm=new Int8Array(10);
function pawnFeat(b,F){const wc=_wc.fill(0),bc=_bc.fill(0),wmin=_wm.fill(8),bmax=_bm.fill(-1),wp=[],bp=[];
 for(let q=0;q<128;q++){if(q&136){q+=7;continue}const x=b[q];
  if(x===1){const f=(q&7)+1,r=q>>4;wc[f]++;if(r<wmin[f])wmin[f]=r;wp.push(q)}
  else if(x===-1){const f=(q&7)+1,r=q>>4;bc[f]++;if(r>bmax[f])bmax[f]=r;bp.push(q)}}
 let dbl=0,iso=0,pr=0,pm=0,pe=0;
 for(let f=1;f<9;f++){if(wc[f]>1)dbl+=wc[f]-1;if(bc[f]>1)dbl-=bc[f]-1;if(wc[f]&&!wc[f-1]&&!wc[f+1])iso+=wc[f];if(bc[f]&&!bc[f-1]&&!bc[f+1])iso-=bc[f]}
 for(const q of wp){const f=(q&7)+1,r=q>>4;if(bmax[f-1]<=r&&bmax[f]<=r&&bmax[f+1]<=r){pr+=r;pm+=PBM[r];pe+=PBE[r]}}
 for(const q of bp){const f=(q&7)+1,r=q>>4;if(wmin[f-1]>=r&&wmin[f]>=r&&wmin[f+1]>=r){const rr=7-r;pr-=rr;pm-=PBM[rr];pe-=PBE[rr]}}
 F[0]=dbl;F[1]=iso;F[2]=pr;F[3]=pm;F[4]=pe}
const shieldB=(b,k,col)=>{if(k<0||(col>0?(k>>4)>1:(k>>4)<6))return 0;let m=0;for(let d=-1;d<2;d++){const q=k+16*col+d;if(!(q&136)&&b[q]===col)m++}return m};
// Adds sc * d(evaluation, side to move)/d(parameter) for every learned parameter into out (Float64Array(NP))
const _GF=new Int32Array(5);
function grad(p,out,sc){const b=p.b,s=p.s,F=_GF;let ph=0,wk=-1,bk=-1,bw=0,bb=0;
 for(let q=0;q<128;q++){if(q&136){q+=7;continue}const x=b[q];if(!x)continue;ph+=PW[x<0?-x:x];if(x===6)wk=q;else if(x===-6)bk=q;else if(x===3)bw++;else if(x===-3)bb++}
 const wm=Math.min(24,ph)/24,we=1-wm;
 for(let q=0;q<128;q++){if(q&136){q+=7;continue}const x=b[q];if(!x)continue;const a=x<0?-x:x,sg=x<0?-1:1,j=IX(sg,q),k=sc*s*sg;
  if(a<6)out[OV+a-1]+=k;out[OP+(a-1)*64+j]+=k*wm;out[OW+(a-1)*64+j]+=k*we}
 pawnFeat(b,F);const k=sc*s;
 out[OX]+=k*((bw>1?1:0)-(bb>1?1:0));out[OX+1]-=k*F[0];out[OX+2]-=k*F[1];out[OX+3]+=k*we*F[2];
 out[OX+4]+=k*wm*(shieldB(b,wk,1)-shieldB(b,bk,-1));out[OX+5]+=sc}
// ======================= self-play, learning, duels =======================
const sig=x=>1/(1+Math.exp(-x/400)),up=(o,k,v)=>{const a=o[k]||(o[k]=v.map(()=>0));v.forEach((x,i)=>a[i]+=+x)};
const mvId=(b,m,s)=>{const f=m&127,t=(m>>7)&127,x=Math.abs(b[f]),c=(m>>17)===1?1:Math.abs(b[t]);return(x*7+c)*64+IX(s,t)};
const DEF={depth:3,nodes:2500,eps:.05,nz:25,bk:100,max:200,mu:.5,pat:1,st:1};
// One self-play game. E searches for the side of K; EO (optional) is an older brain playing the other colour (league play).
function game(E,EO,K,D,G,o,lg){const sd=Math.random()<.5?1:-1,P0=start(),R=[],smp=[],mats=[0],B=[];let key='',mat=0,res=0,streak=0,sgn=0,ply=0,calm=0;
 E.set(P0);E.clearTT();if(EO){EO.set(P0);EO.clearTT()}
 for(;;){const M=EO&&E.side!==sd?EO:E,s=E.side,L=E.legalMoves();
  if(!L.length){res=E.mated();break}
  if(E.half>=100||E.insuf()||E.repCount()>=3){res=0;break}
  if(ply>=o.max){res=Math.abs(mat)>=300?Math.sign(mat):0;break}
  const chk=E.inCheck();let m,sc=0,ms=null;
  if(ply<10){ // opening: one-move lookahead with noise and the learned opening statistics
   let best=-1e9;for(const x of L){E.make(x);const v=-E.qsearch();E.unmake();let w=v+Math.random()*o.nz;
    const e=K.op[key+(x&16383)+','];if(e){const q=e[0]+e[1]+e[2];w+=o.bk*(((s>0?e[0]:e[2])+e[1]/2)/q-.5)*Math.min(1,q/5)+30/Math.sqrt(q+1)}else w+=30;
    if(w>best){best=w;m=x}}
  }else{const r=o.depth===0?M.quick(L,o.nz):M.search({nodes:o.nodes,depth:o.depth,ms:1e9,rank:o.pat,rd:2,L});m=r.m;sc=r.score;
   if(r.score>=MATE-1&&Math.random()<o.eps){ms=((Math.abs(E.peek(m&127))*7+((m>>17)===1?1:Math.abs(E.peek((m>>7)&127))))*64+IX(s,(m>>7)&127));m=L[Math.random()*L.length|0]}   // sometimes overlook a mate in one (feeds the "missed mate" statistic)
   else if(Math.random()<o.eps)m=L[Math.random()*L.length|0];
   if(Math.abs(sc)>=700){if(sgn===Math.sign(sc*s))streak++;else{sgn=Math.sign(sc*s);streak=1}}else streak=0;calm=Math.abs(sc)<25?calm+1:0}
  const f=m&127,t=(m>>7)&127,pr=(m>>14)&7,fl=m>>17,x=Math.abs(E.peek(f)),c=fl===1?1:Math.abs(E.peek(t)),id=(x*7+c)*64+IX(s,t);
  let pos=null;if(!o.nograd&&ply>=10&&!c&&!pr&&!chk&&Math.abs(sc)<1500&&ply%o.st===0){pos=E.snap();pos.sc=sc;pos.ev=E.evaluate()}   // snapshot only when this position is used for learning
  if(lg)lg.push(san(E,m,L));
  const pk=E.ctx(m);
  const tg=[c?(SV[c]>SV[x]?'winning capture':'capture'):'quiet'];
  E.make(m);if(EO)EO.make(m);const ck=E.inCheck();
  if(ck)tg.push('check');if(pr)tg.push('promotion');if(fl===2)tg.push('castle');if(fl===1)tg.push('en passant');
  R.push({s,id,tg,ms,pk});mat+=s*(SV[c]+(pr?800:0));mats.push(mat);
  if(ply<10){key+=(m&16383)+',';B.push(key)}
  else if(pos)smp.push(pos);
  ply++;
  if(streak>=3&&ply>=20){res=sgn;break}
  if(calm>=24&&ply>=90){res=0;break}}
 if(lg)lg.res=res;return fin(E,K,D,G,o,R,B,smp,mats,res)}
function fin(E,K,D,G,o,R,B,smp,mats,res){
 D.g++;D[res>0?'w':res<0?'l':'d']++;const ri=res>0?0:res<0?2:1,n=R.length;D.pl+=n;
 for(const k of B)up(D.op,k,[ri===0,ri===1,ri===2]);
 R.forEach((r,i)=>{const s=r.s,z=res*s,d=(mats[Math.min(i+2,n)]-mats[i])*s,a=[1,z>0,z<0,d];
  up(D.mv,r.id,a);up(D.pat,r.pk,[1,z>0,z<0]);up(D.pt2,coarse(r.pk),[1,z>0,z<0]);if(o.keepR)o.keepR.push([r.pk,z]);for(const t of r.tg)up(D.tag,t,a);
  if(d<=-200)up(D.sac,r.id,[1,z>0,(mats[Math.min(i+4,n)]-mats[i])*s>=-100]);
  if(r.ms!=null)up(D.miss,r.ms,[1])});
 // learning signal: make the static evaluation of quiet positions predict a mix of the later search score and the game result
 for(const p of smp){const ev=p.ev,Rt=(res*p.s+1)/2,T=(1-o.mu)*sig(p.sc)+o.mu*Rt;grad(p,G.g,(sig(ev)-T)/400);G.n++;if(o.keep)o.keep.push({b:Array.from(p.b),s:p.s,c:p.c,ep:p.ep,h:p.h,z:Rt})}}
// Play games for ms milliseconds with fixed parameters. Returns statistics and the summed gradient (merge() applies it).
function batch(K,ms,o){o=Object.assign({},DEF,o);const D={g:0,w:0,d:0,l:0,pl:0,op:{},mv:{},sac:{},miss:{},tag:{},pat:{},pt2:{}},G={g:new Float64Array(NP),n:0},
 E=Engine(K,{tt:o.depth<2?13:16}),EO=o.opp?Engine(o.opp,{tt:o.depth<2?13:15}):null,t=Date.now();let n=0;
 let log=null;do{const lg=n===0&&o.log?[]:null;game(E,EO,K,D,G,o,lg);if(lg)log=lg;n++}while(Date.now()-t<ms);
 return{D,n,G:Array.from(G.g),ns:G.n,keep:o.keep,log:log&&{m:log,res:log.res}}}
const TUNE={LR:1,decay:400},B1=.9,B2=.999;
function merge(K,R){const D=R.D;for(const k of['g','w','d','l','pl'])K[k]=(K[k]||0)+(D[k]||0);
 for(const s of['op','mv','sac','miss','tag','pat','pt2']){const a=K[s];for(const k in D[s]){const v=D[s][k],x=a[k];if(x)v.forEach((y,i)=>x[i]+=y);else a[k]=v}}
 if(R.ns>0){const th=flat(K);let op=K.opt;if(!op||!op.m||op.m.length!==NP)op=K.opt={t:0,m:new Array(NP).fill(0),v:new Array(NP).fill(0)};
  op.t++;const c1=1-Math.pow(B1,op.t),c2=1-Math.pow(B2,op.t),lr=TUNE.LR*Math.max(.25,1/Math.sqrt(1+op.t/TUNE.decay))*Math.min(1,Math.max(.2,Math.sqrt(R.ns/2000)));   // small batches = noisier gradient = smaller step
  for(let i=0;i<NP;i++){const g=R.G[i]/R.ns;op.m[i]=B1*op.m[i]+(1-B1)*g;op.v[i]=B2*op.v[i]+(1-B2)*g*g;
   th[i]-=(i>=OX?lr*.25:lr)*(op.m[i]/c1)/(Math.sqrt(op.v[i]/c2)+1e-9);
   th[i]=i<OP?Math.max(30,Math.min(2000,th[i])):i<OX?Math.max(-150,Math.min(150,th[i])):Math.max(-30,Math.min(30,th[i]))}
  unflat(K,th)}
 for(let m=3;Object.keys(K.pat).length>60000&&m<500;m*=2)for(const k in K.pat)if(K.pat[k][0]<m)delete K.pat[k];
 for(let m=3;Object.keys(K.op).length>40000&&m<500;m*=2)for(const k in K.op){const e=K.op[k];if(e[0]+e[1]+e[2]<m)delete K.op[k]}}
// A against B (brains or null for the plain classical evaluation), n games from shared random openings with colours swapped. Returns A's score 0..1
function duel(A,B,n,o){o=Object.assign({depth:4,nodes:3000,max:160},o);const EA=Engine(A,{tt:16}),EB=Engine(B,{tt:16});let sc=0;let open=null;
 for(let i=0;i<n;i++){const a=i&1?-1:1;
  if(!(i&1)){const T=Engine(null,{tt:4});T.set(start());open=[];for(let k=0;k<6;k++){const L=T.legalMoves();let m,tries=0;do{m=L[Math.random()*L.length|0];T.make(m);const v=Math.abs(T.qsearch());if(v<150||tries>20){open.push(m);break}T.unmake();tries++}while(1)}}
  EA.set(start());EB.set(start());EA.clearTT();EB.clearTT();for(const m of open){EA.make(m);EB.make(m)}
  let res=0,streak=0,sgn=0;
  for(let ply=6;;ply++){const s=EA.side,L=EA.legalMoves();
   if(!L.length){res=EA.mated();break}
   if(EA.half>=100||EA.insuf()||EA.repCount()>=3||ply>=o.max){res=0;break}
   const r=(s===a?EA:EB).search({nodes:o.nodes,depth:o.depth,ms:1e9});EA.make(r.m);EB.make(r.m);
   if(Math.abs(r.score)>=900){if(sgn===Math.sign(r.score*s))streak++;else{sgn=Math.sign(r.score*s);streak=1}}else streak=0;
   if(streak>=4){res=sgn;break}}
  sc+=res===0?.5:res===a?1:0}
 return sc/n}
// Best move for a real position {b,s,c,ep,h}. rep: flat hashes of earlier positions. The searcher is cached per brain.
let TH=null;
function think(K,pos,rep,o){const sg=K?JSON.stringify([K.V,K.P,K.W,K.X]):'';if(!TH||TH.sg!==sg)TH={sg,E:Engine(K,{tt:18})};TH.E.setModel(K);TH.E.set(pos,rep);return TH.E.search(Object.assign({rank:!!(K&&K.pat)},o))}
// ---- learning from real games (called by the page) ----
let HL2=null;const eng2=()=>HL2||(HL2=Engine(null,{tt:4}));
const findMove=(E,mv)=>E.legalMoves().find(m=>(m&127)===mv.f&&((m>>7)&127)===mv.t&&((m>>14)&7)===(mv.pr||0));
// the opponent (a human) played mv in position pos: remember it, so the engine can predict that habit
function noteMove(K,pos,mv){const E=eng2();E.set(pos);const m=findMove(E,mv);if(!m)return 0;
 const k=E.hash[0]>>>0,d=K.pred[k]||(K.pred[k]={});d[m]=(d[m]||0)+1;
 if(Object.keys(K.pred).length>40000)for(const q in K.pred){let t=0;for(const x in K.pred[q])t+=K.pred[q][x];if(t<2)delete K.pred[q]}
 return m}
// finished game: entries [{pos,f,t,pr}] in order, res = +1 white won, -1 black won, 0 draw
function learnGame(K,entries,res){const E=eng2();for(const e of entries){E.set(e.pos);const m=findMove(E,e);if(!m)continue;
 const z=res*e.pos.s;const k=E.ctx(m);up(K.pat,k,[1,z>0,z<0]);up(K.pt2,coarse(k),[1,z>0,z<0])}}
// the position's key and predicted reply, for display / hit tracking
const predicted=(K,pos)=>{const E=eng2();E.set(pos);const d=K.pred[E.hash[0]>>>0];if(!d)return null;let tot=0,bm=0,bc=0;for(const k in d){tot+=d[k];if(d[k]>bc){bc=d[k];bm=+k}}return tot>=2?{m:bm,p:bc/tot,n:tot}:null};
const perft=(p,d)=>{const E=Engine(null,{tt:4});E.set(p);return E.perft(d)};
let HE=null;const hashPos=p=>{HE=HE||Engine(null,{tt:4});HE.set(p);return HE.hash};
const CH={coarse,patEst,fresh,migrate,pack,unpack,PASS,VER,start,Engine,batch,merge,duel,think,noteMove,learnGame,predicted,perft,hashPos,grad,flat,unflat,NP,MATE,TUNE};
if(typeof module!=='undefined')module.exports=CH;else globalThis.CH=CH;
})();
