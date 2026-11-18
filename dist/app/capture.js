class CantusCapture extends AudioWorkletProcessor {
  constructor(){super();this.block=new Float32Array(1024);this.index=0;this.phase=0;this.sum=0;this.count=0;}
  process(inputs,outputs){
    const x=inputs[0]?.[0];if(!x)return true;
    for(let i=0;i<x.length;i++){
      this.sum+=x[i];this.count++;this.phase+=16000;
      if(this.phase>=sampleRate){this.phase-=sampleRate;this.block[this.index++]=this.sum/this.count;this.sum=0;this.count=0;
        if(this.index===1024){this.port.postMessage({samples:this.block,time:currentTime+i/sampleRate},[this.block.buffer]);this.block=new Float32Array(1024);this.index=0;}
      }
    }
    // Microphone is never monitored to the speakers.
    return true;
  }
}
registerProcessor('cantus-capture',CantusCapture);
