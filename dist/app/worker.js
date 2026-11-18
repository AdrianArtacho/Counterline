import {RATE,monoPitch,pairPitch,PitchSmoother,CantusFollower,referenceAt} from './dsp.js';
let ring=new Float32Array(4096),count=0,mode='learn',frames=[],follower=null,settings={},a=new PitchSmoother(),b=new PitchSmoother(),session=0;
self.onmessage=({data:d})=>{
  if(d.type==='reset'){session=d.session;ring.fill(0);count=0;mode=d.mode;frames=d.frames||[];settings=d.settings||{};follower=new CantusFollower(frames);follower.reset(d.position||0);a.reset();b.reset();return;}
  if(d.type==='settings'){settings={...settings,...d.settings};return;}
  if(d.type==='seek'){follower?.reset(d.position);a.reset();b.reset();return;}
  if(d.type!=='audio'||d.session!==session)return;
  const samples=d.samples;ring.copyWithin(0,samples.length);ring.set(samples,ring.length-samples.length);count+=samples.length;if(count<ring.length)return;
  const t=count/RATE-ring.length/(2*RATE),opts={smooth:settings.smooth,jump:settings.jump};let result;
  if(mode==='learn'||mode==='solo'){
    const p=monoPitch(ring,RATE,settings.gate);const f=b.update(p.f,t,mode==='learn'?{smooth:0,jump:80}:opts);
    result={a:mode==='solo'?referenceAt(frames,d.refTime):null,b:f,confidence:p.f?p.confidence:0,level:p.level};
    if(mode==='learn')result.raw=p.f;
  }else{
    const expected=mode==='speaker'||mode==='demo'?referenceAt(frames,d.refTime):follower.expected();
    const p=pairPitch(ring,{expected,spread:settings.spread,gate:settings.gate});
    if(mode==='choir'){
      follower.update(p.candidates||[],samples.length/RATE);
      if(!follower.locked){p.a=null;p.b=null;p.confidence=0;p.reason='lost';}
    }
    result={...p,a:a.update(p.a,t,opts),b:b.update(p.b,t,opts),position:follower.position};
  }
  self.postMessage({type:'pitch',session,t,...result});
};
