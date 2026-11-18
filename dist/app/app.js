import {RATE,monoPitch,midi,hz,intervalInfo,synthTone,referenceAt,clamp} from './dsp.js';
const $=id=>document.getElementById(id);
let mode='solo',action='idle',busy=false,ctx=null,stream=null,capture=null,micSource=null,playSource=null,gain=null,playStart=0,playOffset=0,playDuration=0;
let worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'}),session=0,recordChunks=[],recordFrames=[],recordSamples=0,track=null,tracks=[],db=null,history=[],lastResult=null,analysisTimer=null,demoSamples=null,demoCursor=0,wake=null;
const settings=()=>({smooth:+$('smooth').value,jump:+$('jump').value,spread:+$('spread').value,gate:+$('gate').value/1000});
const formatTime=t=>`${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const note=f=>{if(!f)return '—';const n=Math.round(midi(f)),names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];return names[((n%12)+12)%12]+(Math.floor(n/12)-1);};
function notify(s){$('notice').textContent=s;$('notice').hidden=!s;}
function status(s,kind=''){const el=$('status');el.className='status '+kind;el.replaceChildren(Object.assign(document.createElement('i'),{}),document.createTextNode(s));}
function errorText(e){if(e.name==='NotAllowedError')return 'Microphone access was not granted. Allow it in this site’s browser permissions, then try again.';if(e.name==='NotFoundError')return 'No microphone was found. Check your headset or phone input.';if(e.name==='NotReadableError')return 'The microphone is busy. Close other recording apps and try again.';return e.message||'Something went wrong. Please try again.';}
async function guarded(fn){if(busy)return;busy=true;refresh();try{await fn();}catch(e){console.error(e);await stop(false);notify(errorText(e));}finally{busy=false;refresh();}}
function refresh(){
  const idle=action==='idle',has=!!track,valid=has&&track.frames.filter(f=>f.f).length>4;
  $('record').disabled=busy||(!idle&&action!=='record');$('record').textContent=action==='record'?'■ Finish & save':'● Record cantus';$('record').classList.toggle('recording',action==='record');$('recordOrb').classList.toggle('active',action==='record');
  $('practice').disabled=busy||(!valid&&action==='idle')||['record','listen'].includes(action);$('practice').textContent=['solo','speaker','choir','demo'].includes(action)?'■ Stop practice':mode==='choir'?'● Listen to choir':'▶ Start practice';
  for(const id of ['sample','importBtn','soloTab','choirTab','library','output','deleteTrack'])$(id).disabled=busy||!idle;
  $('demo').disabled=busy||!idle;$('trackName').disabled=busy||!idle;$('listen').disabled=busy||!has||(!idle&&action!=='listen');$('listen').textContent=action==='listen'?'■ Stop':'▶ Listen';$('export').disabled=!has||busy;
  $('seek').disabled=busy||!has||!['idle','listen'].includes(action);$('loop').disabled=action==='record'||busy;
  $('trackBox').hidden=!has;$('savedBadge').textContent=has?'LEARNED':'START HERE';
  $('soloTab').classList.toggle('selected',mode==='solo');$('choirTab').classList.toggle('selected',mode==='choir');$('soloTab').setAttribute('aria-pressed',mode==='solo');$('choirTab').setAttribute('aria-pressed',mode==='choir');
  $('outputLabel').hidden=mode==='choir';$('modeDescription').textContent=mode==='solo'?'The cantus plays while the microphone follows your second voice.':'Both parts sing live. The learned melody helps the app follow the cantus.';
  $('cantusLabel').textContent=action==='demo'?'Cantus · sound demo':mode==='choir'?'Cantus · live':'Cantus · recording';
  $('modeHint').textContent=mode==='choir'?'Start at the beginning of the learned phrase. The choir follower is experimental.':$('output').value==='speaker'?'Speaker playback uses experimental two-part detection. Headphones give clearer results.':'Use wired headphones for the clearest reading. Keep this screen open.';
  if(has){$('seek').max=track.duration;$('duration').textContent=formatTime(track.duration);$('learnSummary').textContent=`${Math.round(100*track.frames.filter(f=>f.f).length/Math.max(1,track.frames.length))}% of phrase has a pitch guide`;}
}
async function audio(){
  if(!window.isSecureContext)throw new Error('Microphone access needs HTTPS. Open the published app in Chrome, or use localhost for development.');
  if(!ctx){ctx=new AudioContext({latencyHint:'interactive'});gain=ctx.createGain();gain.gain.value=+$('volume').value/100;gain.connect(ctx.destination);}
  await ctx.resume();return ctx;
}
async function microphone(){
  await audio();if(!navigator.mediaDevices?.getUserMedia)throw new Error('This browser does not support microphone recording. Try current Chrome on Android.');
  stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  if(!ctx.audioWorklet)throw new Error('AudioWorklet is unavailable. Please open this HTTPS app in current Chrome.');
  await ctx.audioWorklet.addModule(new URL('./capture.js',import.meta.url));
  capture=new AudioWorkletNode(ctx,'cantus-capture');micSource=ctx.createMediaStreamSource(stream);micSource.connect(capture);capture.connect(ctx.destination);
  capture.port.onmessage=({data:d})=>{
    if(action==='idle'||action==='listen')return;
    if(action==='record'){recordChunks.push(d.samples.slice());recordSamples+=d.samples.length;$('recordTime').textContent=formatTime(recordSamples/RATE)+' / 2:00';if(recordSamples>=RATE*120&&!busy)guarded(()=>finishRecording());}
    let refTime=d.time-playStart+playOffset-4096/(2*RATE)-+$('alignment').value/1000;
    if(playSource&&$('loop').checked)refTime=((refTime%playDuration)+playDuration)%playDuration;
    worker.postMessage({type:'audio',session,samples:d.samples,refTime},[d.samples.buffer]);
  };
  stream.getTracks().forEach(t=>t.onended=()=>{if(action!=='idle'){stop(false);notify('The microphone disconnected. Reconnect it and start again.');}});
  try{wake=await navigator.wakeLock?.request('screen');}catch{}
}
function resetWorker(kind,position=0){session++;worker.postMessage({type:'reset',session,mode:kind,frames:track?.frames||[],settings:settings(),position});history=[];lastResult=null;}
function stopMic(){if(capture){capture.port.onmessage=null;capture.disconnect();capture=null;}micSource?.disconnect();micSource=null;stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});stream=null;wake?.release().catch(()=>{});wake=null;}
function currentPlayback(){if(!playSource)return +$('seek').value;const t=ctx.currentTime-playStart+playOffset;return $('loop').checked?t%playDuration:Math.min(playDuration,t);}
function stopPlayback(){if(playSource){playSource.onended=null;try{playSource.stop();}catch{}playSource.disconnect();playSource=null;}}
function playback(samples,offset=0,loop=$('loop').checked){
  stopPlayback();const buffer=ctx.createBuffer(1,samples.length,RATE);buffer.copyToChannel(samples,0);playSource=ctx.createBufferSource();playSource.buffer=buffer;playSource.loop=loop;playSource.connect(gain);playDuration=buffer.duration;playOffset=clamp(offset,0,Math.max(0,buffer.duration-.01));playStart=ctx.currentTime+.08;playSource.start(playStart,playOffset);playSource.onended=()=>{if(action!=='idle')stop(false);};
}
async function stop(saveRecord=true){
  if(action==='record'&&saveRecord)return finishRecording();
  const previous=action;if(playSource)$('seek').value=currentPlayback();stopPlayback();stopMic();clearInterval(analysisTimer);analysisTimer=null;demoSamples=null;action='idle';session++;
  $('recordTime').textContent='Ready when you are';$('recordHint').textContent='A short, unaccompanied phrase works best.';$('level').style.width='0%';
  status(previous==='listen'?'Ready to listen':'Stopped');clearReadout('Start again when you’re ready.');refresh();
}
async function startRecording(){
  notify('');await microphone();recordChunks=[];recordFrames=[];recordSamples=0;action='record';resetWorker('learn');$('recordHint').textContent='Sing only the cantus. Tap Finish when you’re done.';status('Recording cantus','active');refresh();
}
async function finishRecording(){
  stopMic();await new Promise(r=>setTimeout(r,120));const data=new Float32Array(recordSamples);let off=0;for(const chunk of recordChunks){data.set(chunk,off);off+=chunk.length;}
  action='idle';session++;recordChunks=[];if(data.length<RATE*.7)throw new Error('That recording was too short. Sing a phrase for at least a second.');
  const learned={id:crypto.randomUUID(),name:$('trackName').value.trim()||'My cantus',samples:data,duration:data.length/RATE,frames:recordFrames,created:Date.now()};
  await addTrack(learned);$('recordTime').textContent='Cantus saved';$('recordHint').textContent='Listen back, then add your second voice.';status('Cantus learned','active');
  if(recordFrames.filter(f=>f.f).length<5)notify('The audio was saved, but a clear melody could not be learned. Try a closer microphone and an unaccompanied, sustained phrase.');else notify('Cantus saved on this device. Use Listen to check it, then start practice.');
}
async function startPractice(){
  notify('');await microphone();action=mode==='choir'?'choir':$('output').value==='speaker'?'speaker':'solo';
  const first=track.frames.find(f=>f.f)?.t||0;resetWorker(action,first);
  if(mode==='solo')playback(track.samples,+$('seek').value);status('Listening…','active');refresh();
}
worker.onmessage=({data:d})=>{
  if(d.session!==session||action==='idle')return;
  $('level').style.width=clamp(d.level*450,0,100)+'%';
  if(action==='record'){recordFrames.push({t:d.t,f:d.b||null});$('recordTime').textContent=formatTime(recordSamples/RATE)+' · '+note(d.b);return;}
  lastResult=d;const now=performance.now()/1000;history.push({t:now,a:d.a,b:d.b});history=history.filter(p=>now-p.t<12);
  if(action==='choir')$('guidePosition').textContent=`Following ${formatTime(d.position||0)} of ${formatTime(track.duration)} · restart if lost`;
  renderResult(d);
};
worker.onerror=e=>{console.error(e);stop(false);notify('The audio analyzer stopped. Reload the app to restart it.');};
function clearReadout(message='Waiting for two clear pitches.'){
  $('intervalName').textContent='Listening for the interval';$('centsReadout').replaceChildren(document.createTextNode('— '),Object.assign(document.createElement('small'),{textContent:'cents'}));$('tuningText').textContent=message;$('needle').style.opacity=0;$('cantusNote').textContent='—';$('secondNote').textContent='—';
}
function renderResult(d){
  const info=intervalInfo(d.a,d.b,$('temperament').value);
  $('targetLabel').textContent=$('temperament').value==='just'?'PURE INTERVAL':'EQUAL TEMPERAMENT';
  if(!info){clearReadout(d.reason==='lost'?'Lost the cantus. Restart the phrase to reconnect.':d.reason==='overlap'?'The two harmonic families are not clear enough.':action==='solo'&&!d.a?'A rest or an unclear moment in the recorded cantus.':'Sing a steady note to bring the interval into focus.');status(d.reason==='lost'?'Guide uncertain':d.reason==='overlap'?'Voices overlap':'Listening…','warning');return;}
  $('intervalName').textContent=info.name;$('centsReadout').replaceChildren(document.createTextNode(info.distance.toFixed(1)+' '),Object.assign(document.createElement('small'),{textContent:'cents'}));
  const diff=info.error,word=Math.abs(diff)<2?'Close to target':`${Math.abs(diff).toFixed(1)} cents ${diff>0?'wide':'narrow'}`;
  $('tuningText').textContent=`${word} · second voice ${info.signed>=0?'above':'below'}`;$('needle').style.opacity=1;$('needle').style.left=clamp(50+diff,3,97)+'%';$('needle').style.background=Math.abs(diff)<8?'var(--green)':'var(--orange)';
  $('cantusNote').textContent=note(d.a);$('secondNote').textContent=note(d.b);status(action==='demo'?'Synthesized sound demo':d.confidence>.72?'Clear signal':'Tentative reading',d.confidence>.72?'active':'warning');$('graphCaption').textContent=action==='demo'?'Synthesized voices, analyzed by the live detector.':'Pitch centres · violet cantus / orange second voice';
}
async function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('counterline',1);req.onupgradeneeded=()=>req.result.createObjectStore('tracks',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbOp(type,value){if(!db)return;return new Promise((resolve,reject)=>{const tx=db.transaction('tracks','readwrite'),store=tx.objectStore('tracks');store[type](value);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function addTrack(t){tracks.unshift(t);track=t;try{await dbOp('put',t);if(!db)notify('Browser storage is unavailable. Export the WAV before closing this page.');}catch{notify('This recording is available for this session. Storage is full or unavailable; export the WAV to keep it.');}selectTrack(t.id);}
function selectTrack(id){track=tracks.find(t=>t.id===id)||null;$('library').replaceChildren(...tracks.map(t=>Object.assign(document.createElement('option'),{value:t.id,textContent:t.name})));if(track){$('library').value=track.id;$('trackName').value=track.name;$('seek').value=0;}history=[];refresh();drawWave();if(track)$('tuningText').textContent='Cantus ready. Choose a mode and start practice.';}
function wav(samples){const buf=new ArrayBuffer(44+samples.length*2),v=new DataView(buf);const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,RATE,true);v.setUint32(28,RATE*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);samples.forEach((s,i)=>v.setInt16(44+i*2,Math.round(clamp(s,-1,1)*32767),true));return new Blob([buf],{type:'audio/wav'});}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function importAudio(file){
  if(!file)return;if(file.size>40*1024*1024)throw new Error('Please choose an audio file smaller than 40 MB and shorter than two minutes.');notify('Reading and learning your recording…');await audio();
  let decoded;try{decoded=await ctx.decodeAudioData(await file.arrayBuffer());}catch{throw new Error('This audio format could not be read. Try WAV, MP3, or an audio format supported by Chrome.');}
  if(decoded.duration>120)throw new Error('Please trim the recording to two minutes or less before importing.');
  const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*RATE),RATE),src=offline.createBufferSource();src.buffer=decoded;src.connect(offline.destination);src.start();const rendered=await offline.startRendering(),samples=rendered.getChannelData(0).slice(),frames=[];
  for(let end=4096;end<=samples.length;end+=1024){const p=monoPitch(samples.subarray(end-4096,end));frames.push({t:(end-2048)/RATE,f:p.f});if(end%(1024*32)===0)await new Promise(r=>setTimeout(r,0));}
  await addTrack({id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,''),samples,duration:samples.length/RATE,frames,created:Date.now()});notify(frames.some(f=>f.f)?'Audio imported and cantus learned. Listen back before practicing.':'Audio imported, but no clear melody was found. Try an unaccompanied recording.');
}
function makeSample(){const notes=[50,53,52,50,57,55,53,52,50],duration=2.2,total=notes.length*duration, samples=new Float32Array(Math.round(total*RATE)),frames=[];notes.forEach((n,i)=>samples.set(synthTone(hz(n),duration),Math.round(i*duration*RATE)));for(let t=.128;t<total;t+=.064){const local=t%duration;frames.push({t,f:local>.12&&local<duration-.08?hz(notes[Math.floor(t/duration)]):null});}return {id:'sample-dorian',name:'Dorian study · synthesized',samples,duration:total,frames,created:Date.now()};}
async function loadSample(){const existing=tracks.find(t=>t.id==='sample-dorian');if(existing)selectTrack(existing.id);else await addTrack(makeSample());notify('Sample cantus loaded. This is synthesized audio, ready for playback and practice.');}
async function startDemo(){
  await audio();await loadSample();notify('Sound demo: two synthesized voices go through the actual two-part detector. No microphone is used.');
  const demo=makeSample();demoSamples=demo.samples.slice();const length=2.2;
  for(let n=0;n<9;n++){const freq=referenceAt(demo.frames,n*length+.5);const upper=synthTone(freq*1.25*2**(8/1200),length,{voices:2,detune:8});const base=Math.round(n*length*RATE);for(let i=0;i<upper.length;i++)demoSamples[base+i]=(demoSamples[base+i]+upper[i])*.8;}
  track=tracks.find(t=>t.id==='sample-dorian');action='demo';resetWorker('demo');demoCursor=0;playback(demoSamples,0,false);status('Synthesized sound demo','active');
  analysisTimer=setInterval(()=>{if(!demoSamples)return;const target=Math.floor(Math.max(0,ctx.currentTime-playStart)*RATE);let budget=4;while(demoCursor+1024<=Math.min(target,demoSamples.length)&&budget--){const samples=demoSamples.slice(demoCursor,demoCursor+1024);demoCursor+=1024;worker.postMessage({type:'audio',session,samples,refTime:(demoCursor-2048)/RATE},[samples.buffer]);}},32);refresh();
}
function prepareCanvas(el){const rect=el.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=rect.width,h=rect.height;if(!w)return null;if(el.width!==Math.round(w*dpr)||el.height!==Math.round(h*dpr)){el.width=Math.round(w*dpr);el.height=Math.round(h*dpr);}const c=el.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);return {c,w,h};}
function drawWave(){const p=prepareCanvas($('waveform'));if(!p||!track)return;const {c,w,h}=p;c.strokeStyle='#b7a8d1';c.lineWidth=1.6;const step=Math.max(1,Math.floor(track.samples.length/w));for(let x=0;x<w;x+=3){let max=0;for(let i=Math.floor(x*step);i<Math.min(track.samples.length,(x+3)*step);i+=8)max=Math.max(max,Math.abs(track.samples[i]));const a=Math.max(1,max*h*.9);c.beginPath();c.moveTo(x,h/2-a);c.lineTo(x,h/2+a);c.stroke();}}
function drawGraph(){const p=prepareCanvas($('pitchGraph'));if(!p)return;const {c,w,h}=p;const pitches=history.flatMap(p=>[p.a,p.b]).filter(Boolean).map(midi);let low=pitches.length?Math.floor(Math.min(...pitches))-2:48,high=pitches.length?Math.ceil(Math.max(...pitches))+2:72;if(high-low<8){low-=4;high+=4;}c.strokeStyle='#eeece9';c.lineWidth=1;for(let i=1;i<5;i++){const y=h*i/5;c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}const now=performance.now()/1000;for(const [key,color] of [['a','#8873bd'],['b','#c87950']]){c.strokeStyle=color;c.lineWidth=2;c.lineJoin='round';c.beginPath();let pen=false,last=0;for(const p of history){if(!p[key]){pen=false;continue;}const x=w*(1-(now-p.t)/12),y=h-10-(midi(p[key])-low)/(high-low)*(h-20);if(!pen||p.t-last>.3)c.moveTo(x,y);else c.lineTo(x,y);pen=true;last=p.t;}c.stroke();}}
$('record').onclick=()=>guarded(()=>action==='record'?finishRecording():startRecording());$('practice').onclick=()=>guarded(()=>action==='idle'?startPractice():stop());$('listen').onclick=()=>guarded(async()=>{if(action==='listen')return stop();await audio();action='listen';playback(track.samples,+$('seek').value);status('Playing cantus','active');});
$('soloTab').onclick=()=>{mode='solo';refresh();};$('choirTab').onclick=()=>{mode='choir';refresh();};$('output').onchange=refresh;
$('sample').onclick=()=>guarded(loadSample);$('demo').onclick=()=>guarded(startDemo);$('importBtn').onclick=()=>$('importFile').click();$('importFile').onchange=()=>guarded(async()=>{try{await importAudio($('importFile').files[0]);}finally{$('importFile').value='';}});
$('library').onchange=()=>selectTrack($('library').value);$('trackName').onchange=async()=>{if(track){track.name=$('trackName').value.trim()||'My cantus';try{await dbOp('put',track);}catch{notify('Name changed for this session; browser storage is unavailable.');}selectTrack(track.id);}};
$('deleteTrack').onclick=()=>guarded(async()=>{if(!track||!confirm(`Delete “${track.name}” from this device?`))return;await dbOp('delete',track.id);tracks=tracks.filter(t=>t.id!==track.id);selectTrack(tracks[0]?.id);notify('Recording deleted from this device.');});
$('export').onclick=()=>download(wav(track.samples),(track.name.replace(/[^a-z0-9 _-]/gi,'')||'cantus')+'.wav');
$('seek').onchange=()=>{if(action==='listen')playback(track.samples,+$('seek').value);};$('loop').onchange=()=>{if(playSource&&action!=='demo')playSource.loop=$('loop').checked;};
$('restartGuide').onclick=()=>{worker.postMessage({type:'seek',position:track?.frames.find(f=>f.f)?.t||0});history=[];status('Guide restarted');};
for(const id of ['smooth','jump','spread','gate','alignment','volume'])$(id).oninput=()=>{
  $('smoothValue').textContent=$('smooth').value+' ms';$('jumpValue').textContent=$('jump').value==='0'?'Off':$('jump').value+' ms';$('spreadValue').textContent=$('spread').value+' cents';$('gateValue').textContent=+$('gate').value<6?'Low':+$('gate').value<12?'Medium':'High';$('alignmentValue').textContent=$('alignment').value+' ms';$('volumeValue').textContent=$('volume').value+'%';if(gain)gain.gain.setTargetAtTime(+$('volume').value/100,ctx.currentTime,.03);worker.postMessage({type:'settings',settings:settings()});try{localStorage.setItem('counterline-settings',JSON.stringify(Object.fromEntries(['smooth','jump','spread','gate','alignment','volume','temperament'].map(id=>[id,$(id).value]))));}catch{}
};
$('temperament').onchange=()=>{if(lastResult)renderResult(lastResult);$('smooth').oninput();};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&action!=='idle'){const recording=action==='record';stop(recording).then(()=>notify(recording?'Recording saved when the app went into the background.':'Practice stopped when the app went into the background. Tap Start to resume.')).catch(e=>notify(errorText(e)));}});
window.addEventListener('pagehide',()=>{stopMic();stopPlayback();});window.addEventListener('resize',drawWave);
setInterval(()=>{drawGraph();if(playSource&&action!=='record'){$('seek').value=currentPlayback();$('duration').textContent=formatTime(currentPlayback())+' / '+formatTime(playDuration);}},100);
async function init(){try{db=await openDB();tracks=await new Promise((resolve,reject)=>{const r=db.transaction('tracks').objectStore('tracks').getAll();r.onsuccess=()=>resolve(r.result.sort((a,b)=>b.created-a.created));r.onerror=()=>reject(r.error);});selectTrack(tracks[0]?.id);}catch{notify('Private browser storage is unavailable. Recordings will last for this session; export WAV files to keep them.');}try{const prefs=JSON.parse(localStorage.getItem('counterline-settings')||'{}');for(const [id,val] of Object.entries(prefs))if($(id))$(id).value=val;$('smooth').oninput();}catch{}refresh();drawGraph();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});}
init();
