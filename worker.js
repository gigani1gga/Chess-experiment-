// Web Worker: self-play batches and move search. (The page normally builds its workers from the inlined engine instead.)
importScripts('engine.js');
onmessage=e=>{const d=e.data;
 if(d.think)postMessage({id:d.id,r:CH.think(d.K,d.pos,d.rep,d.o)});
 else postMessage(CH.batch(d.K,d.ms,d.o))};
