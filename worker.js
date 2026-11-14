importScripts('engine.js');
onmessage=e=>postMessage(CH.batch(e.data.K,e.data.ms,e.data.o));
