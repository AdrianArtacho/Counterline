import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as dsp from '../dist/app/dsp.js';

test('AudioWorklet captures 44.1 and 48 kHz input as ordered 16 kHz mono without monitoring',()=>{
  const source=readFileSync(new URL('../dist/app/capture.js',import.meta.url),'utf8');
  for(const sr of [44100,48000]){
    let Processor;const blocks=[];
    const env={sampleRate:sr,currentTime:0,AudioWorkletProcessor:class{constructor(){this.port={postMessage:d=>blocks.push(d.samples)};}},registerProcessor:(_,c)=>{Processor=c;},Float32Array};vm.runInNewContext(source,env);
    const p=new Processor();let inputCount=0;
    for(let n=0;n<Math.floor(sr/128);n++){const x=Float32Array.from({length:128},(_,i)=>Math.sin(2*Math.PI*220*(inputCount+i)/sr)*.2),out=new Float32Array(128);p.process([[x]],[[out]]);assert.ok(out.every(v=>v===0));inputCount+=128;env.currentTime=inputCount/sr;}
    const joined=Float32Array.from(blocks.flatMap(b=>Array.from(b)));assert.ok(joined.length>14000&&joined.length<=16000);
    const result=dsp.monoPitch(joined.slice(2000,6096));assert.ok(Math.abs(dsp.cents(result.f,220))<3);
  }
});

test('worker learns a reference, then compares a headphone voice with it at playback time',()=>{
  const messages=[];const source=readFileSync(new URL('../dist/app/worker.js',import.meta.url),'utf8').replace(/^import .*?;\n/,'');const self={postMessage:d=>messages.push(d)};vm.runInNewContext(source,{...dsp,self,Float32Array});
  const send=d=>self.onmessage({data:d});const input=dsp.synthTone(220,1);
  send({type:'reset',session:1,mode:'learn',settings:{smooth:0,jump:0,gate:.004}});
  for(let i=0;i+1024<=input.length;i+=1024)send({type:'audio',session:1,samples:input.slice(i,i+1024)});
  const learned=messages.map(d=>({t:d.t,f:d.b}));assert.ok(learned.filter(f=>f.f).length>8);messages.length=0;
  send({type:'reset',session:2,mode:'solo',frames:learned,settings:{smooth:0,jump:0,gate:.004}});
  const singer=dsp.synthTone(275,1);for(let i=0;i+1024<=singer.length;i+=1024)send({type:'audio',session:2,samples:singer.slice(i,i+1024),refTime:(i+1024-2048)/dsp.RATE});
  const valid=messages.filter(d=>d.a&&d.b);assert.ok(valid.length>8);const avg=valid.reduce((s,d)=>s+dsp.cents(d.b,d.a),0)/valid.length;assert.ok(Math.abs(avg-386.3137)<10);
  const before=messages.length;send({type:'audio',session:1,samples:input.slice(0,1024)});assert.equal(messages.length,before,'old sessions cannot update the UI');
});
