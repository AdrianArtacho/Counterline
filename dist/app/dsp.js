// All pitch measurements remain continuous. Musical note labels are display-only.
export const RATE = 16000;
export const cents = (a,b) => 1200*Math.log2(a/b);
export const midi = f => 69+12*Math.log2(f/440);
export const hz = m => 440*2**((m-69)/12);
export const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
export function rms(x) { let s=0; for(const v of x)s+=v*v; return Math.sqrt(s/x.length); }

export function monoPitch(x, sr=RATE, gate=.004) {
  const level=rms(x); if(level<gate)return {f:null,confidence:0,level};
  const maxLag=Math.min(Math.floor(sr/65),Math.floor(x.length/2)-1), minLag=Math.floor(sr/1050);
  const n=Math.min(2048,x.length-maxLag), diff=new Float64Array(maxLag+1);
  let sum=0;
  for(let lag=1;lag<=maxLag;lag++) {
    let d=0; for(let i=0;i<n;i++){const v=x[i]-x[i+lag];d+=v*v;}
    sum+=d; diff[lag]=sum>0?d*lag/sum:1;
  }
  let best=-1;
  for(let lag=minLag;lag<maxLag;lag++)if(diff[lag]<.18){while(lag+1<maxLag&&diff[lag+1]<diff[lag])lag++;best=lag;break;}
  if(best<0){best=minLag;for(let k=minLag;k<maxLag;k++)if(diff[k]<diff[best])best=k;}
  const confidence=1-diff[best];
  if(confidence<.72||best<=minLag||best>=maxLag)return {f:null,confidence:0,level};
  const a=diff[best-1],b=diff[best],c=diff[best+1],den=a-2*b+c;
  const pos=best+(den?clamp(.5*(a-c)/den,-.5,.5):0);
  return {f:sr/pos,confidence:clamp(confidence,0,1),level};
}

function spectrum(x) {
  const n=x.length,re=new Float64Array(n),im=new Float64Array(n);
  for(let i=0;i<n;i++)re[i]=x[i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j)[re[i],re[j]]=[re[j],re[i]];}
  for(let len=2;len<=n;len<<=1){const angle=-2*Math.PI/len,cr=Math.cos(angle),ci=Math.sin(angle);for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){const a=i+j,b=a+len/2,tr=wr*re[b]-wi*im[b],ti=wr*im[b]+wi*re[b];re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;const nw=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=nw;}}}
  return re.slice(0,n/2).map((v,i)=>Math.hypot(v,im[i]));
}
export function spectralCandidates(x,sr=RATE,spread=25) {
  const mag=spectrum(x),bin=sr/x.length;let peak=0;for(const a of mag)peak=Math.max(a,peak);
  const peaks=[];
  for(let k=2;k<Math.min(mag.length-1,Math.floor(6500/bin));k++){
    if(mag[k]<peak*.025||mag[k]<=mag[k-1]||mag[k]<mag[k+1])continue;
    const a=Math.log(mag[k-1]+1e-12),b=Math.log(mag[k]+1e-12),c=Math.log(mag[k+1]+1e-12);
    const shift=clamp(.5*(a-c)/(a-2*b+c||1),-.5,.5);
    peaks.push({f:(k+shift)*bin,a:(mag[k]/peak)**.8});
  }
  peaks.sort((a,b)=>b.a-a.a);peaks.splice(48);peaks.sort((a,b)=>a.f-b.f);
  const cand=[];
  for(const p of peaks)for(let h=1;h<=6;h++){
    const f=p.f/h;if(f<65||f>1050||cand.some(c=>Math.abs(cents(f,c.f))<16))continue;
    const matches=peaks.map(q=>{const k=Math.round(q.f/f);if(k<1||k>12)return 0;const err=Math.abs(cents(q.f,k*f));const tol=Math.max(spread,1200*Math.log2(1+bin*.65/q.f));return err<tol?Math.exp(-.5*(err/(tol*.6))**2)/k**.42:0;});
    let score=0,weight=0,refined=0,hits=0;
    matches.forEach((m,i)=>{if(m){const w=m*peaks[i].a;score+=w;refined+=w*peaks[i].f/Math.round(peaks[i].f/f);weight+=w;hits++;}});
    if(weight)cand.push({f:refined/weight,score,matches,hits});
  }
  cand.sort((a,b)=>b.score-a.score);
  return {candidates:cand.slice(0,36),peaks};
}

// Joint harmonic explanation: a second voice needs evidence that the first
// voice does not explain. Exact octave/unison mixtures may remain ambiguous.
export function pairPitch(x,{expected=null,spread=30,gate=.004}={}) {
  const level=rms(x);if(level<gate)return {a:null,b:null,confidence:0,level,reason:'quiet'};
  const {candidates,peaks}=spectralCandidates(x,RATE,spread);
  if(!candidates.length)return {a:null,b:null,confidence:0,level,reason:'uncertain'};
  const total=peaks.reduce((s,p)=>s+p.a,0),maxScore=candidates[0].score;
  const roots=expected?candidates.filter(c=>Math.abs(cents(c.f,expected))<260):candidates.slice(0,8);
  let best=null;
  for(const a of roots)for(const b of candidates){
    if(Math.abs(cents(a.f,b.f))<65)continue;
    let joint=0,uniqueA=0,uniqueB=0;
    for(let i=0;i<peaks.length;i++){
      const ma=a.matches[i],mb=b.matches[i],v=peaks[i].a;
      joint+=v*Math.max(ma,mb);
      if(ma>.2&&mb===0)uniqueA+=v*ma;
      if(mb>.2&&ma===0)uniqueB+=v*mb;
    }
    if(uniqueA<total*.075||uniqueB<total*.075||a.score<maxScore*.22||b.score<maxScore*.22)continue;
    const prior=expected?Math.exp(-.5*(cents(a.f,expected)/120)**2):1;
    const score=joint*(.82+.18*prior);
    if(!best||score>best.score)best={a:a.f,b:b.f,score,confidence:clamp(joint/total,0,1)};
  }
  if(!best)return {a:null,b:null,confidence:0,level,reason:'overlap',candidates:candidates.slice(0,8).map(c=>c.f)};
  if(!expected&&best.a>best.b)[best.a,best.b]=[best.b,best.a];
  return {...best,level,candidates:candidates.slice(0,8).map(c=>c.f)};
}

export class PitchSmoother {
  constructor(){this.reset();}
  reset(){this.value=null;this.last=null;this.pending=null;this.pendingAt=0;this.validAt=-Infinity;}
  update(f,t,{smooth=300,jump=140,threshold=180}={}) {
    if(!f){if(t-this.validAt>.25){this.value=null;this.pending=null;}return null;}
    const p=midi(f)*100,dt=this.last===null?.064:clamp(t-this.last,.001,.5);this.last=t;
    if(this.value===null){this.value=p;this.validAt=t;return f;}
    if(Math.abs(p-this.value)>threshold&&jump>0){
      if(this.pending===null||Math.abs(p-this.pending)>65){this.pending=p;this.pendingAt=t;}
      if((t-this.pendingAt)*1000<jump){if(t-this.validAt>.25)return null;return hz(this.value/100);}
      this.value=p;this.pending=null;
    }else {this.pending=null;this.value+= (p-this.value)*(smooth?1-Math.exp(-dt/(smooth/1000)):1);}
    this.validAt=t;return hz(this.value/100);
  }
}

export function referenceAt(frames,t) {
  if(!frames?.length||t<0)return null;
  let lo=0,hi=frames.length-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(frames[m].t<=t)lo=m;else hi=m-1;}
  const a=frames[lo],b=frames[lo+1];
  if(Math.abs(a.t-t)>.15)return null;
  if(!a.f)return null;
  if(b?.f&&Math.abs(cents(a.f,b.f))<100){const w=clamp((t-a.t)/(b.t-a.t),0,1);return a.f*2**(cents(b.f,a.f)*w/1200);}
  return a.f;
}

// A small online beam search over the learned pitch contour. Tempo is flexible;
// rests and weak evidence cannot advance the guide indefinitely.
export class CantusFollower {
  constructor(frames){this.frames=frames;this.reset();}
  reset(time=0){this.position=time;this.drift=0;this.lastTime=null;this.missed=0;this.locked=false;}
  expected(){return referenceAt(this.frames,this.position)*2**(this.drift/1200)||null;}
  update(candidates,dt=.064){
    if(!this.frames.length)return null;
    const start=this.position;let best=null;
    // Include the held position as well as slow/normal/quick local advances.
    for(const advance of [0,dt*.5,dt,dt*1.5,dt*2,dt*3]){
      const pos=Math.min(this.frames.at(-1).t,start+advance),f=referenceAt(this.frames,pos);
      if(!f)continue;
      for(let rank=0;rank<Math.min(candidates.length,8);rank++){
        const measured=candidates[rank],err=cents(measured,f)-this.drift;
        const cost=Math.abs(err)+rank*9+Math.abs(advance-dt)*55;
        if(Math.abs(err)<160&&(!best||cost<best.cost))best={pos,f,measured,cost,err};
      }
    }
    if(best){this.position=best.pos;this.drift=clamp(this.drift+best.err*.035,-150,150);this.missed=0;this.locked=true;return this.expected();}
    this.missed+=dt;this.locked=this.missed<.65;
    // Traverse short learned rests, but never invent audible pitches for them.
    if(!referenceAt(this.frames,this.position)&&this.missed<1.5)this.position+=dt;
    return this.locked?this.expected():null;
  }
}

export function intervalInfo(a,b,temperament='just') {
  if(!a||!b)return null;
  const signed=cents(b,a),distance=Math.abs(signed),semi=Math.round(distance/100),pc=semi%12,oct=Math.floor(semi/12);
  const names=['Unison','Minor second','Major second','Minor third','Major third','Perfect fourth','Tritone','Perfect fifth','Minor sixth','Major sixth','Minor seventh','Major seventh'];
  const ratios=[1,16/15,9/8,6/5,5/4,4/3,Math.SQRT2,3/2,8/5,5/3,9/5,15/8];
  const target=temperament==='equal'?semi*100:1200*Math.log2(ratios[pc])+1200*oct;
  return {name:semi===12?'Octave':semi>12?(pc===0?`${oct} octaves`:`${names[pc]} + ${oct} oct.`):names[pc],distance,signed,error:distance-target,target,semi};
}

export function synthTone(f,duration,{sr=RATE,detune=0,voices=1}={}){
  const x=new Float32Array(Math.round(duration*sr));
  for(let i=0;i<x.length;i++){
    const t=i/sr,env=Math.min(1,t/.06,(duration-t)/.08);let v=0;
    for(let voice=0;voice<voices;voice++){
      const ff=f*2**((detune*(voice-(voices-1)/2))/1200);
      const phase=2*Math.PI*ff*t + .12*Math.sin(2*Math.PI*(4.5+voice*.3)*t);
      for(let h=1;h<=7;h++)v+=Math.sin(h*phase+voice*.7)/h**1.35;
    }
    x[i]=v*.22*env/voices;
  }return x;
}
