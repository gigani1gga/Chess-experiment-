// node test.js : rule-correctness self-test (perft = exact count of legal move sequences; covers castling, en passant, promotion, pins, checks)
// plus a check that checkmate is credited to the side that delivered it.
const CH=require('./engine.js');
const fen=f=>{const[bd,sd,ca,ep]=f.split(' '),b=new Int8Array(128),M={p:1,n:2,b:3,r:4,q:5,k:6};let r=7,c=0;
 for(const ch of bd){if(ch==='/'){r--;c=0}else if(/\d/.test(ch))c+=+ch;else{const l=ch.toLowerCase();b[r*16+c]=M[l]*(ch===l?-1:1);c++}}
 let cs=0;if(ca.includes('K'))cs|=1;if(ca.includes('Q'))cs|=2;if(ca.includes('k'))cs|=4;if(ca.includes('q'))cs|=8;
 return{b,s:sd==='w'?1:-1,c:cs,ep:ep==='-'?-1:('abcdefgh'.indexOf(ep[0])+16*(+ep[1]-1)),h:0}};
const T=[['start position','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',4,197281],
['castling + en passant + pins','r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -',3,97862],
['en passant pins, endgame','8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -',4,43238],
['promotions + castling','r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -',3,9467],
['promotion with capture','rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -',3,62379]];
let bad=0;for(const[n,f,d,e]of T){const g=CH.perft(fen(f),d);console.log(g===e?'PASS':'FAIL',n,g);if(g!==e)bad++}
const E=CH.Engine(null,{tt:4});E.set(CH.start());for(const[f,t]of[[21,53],[100,68],[22,54],[115,55]])E.make(E.legalMoves().find(m=>(m&127)===f&&((m>>7)&127)===t));
const ok=E.legalMoves().length===0&&E.mated()===-1;console.log(ok?'PASS':'FAIL',"fool's mate is credited to Black");if(!ok)bad++;
process.exit(bad?1:0);
