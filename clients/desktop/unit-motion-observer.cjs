'use strict';
const {createHash}=require('node:crypto');
const plan=require('./unit-motion-observer-plan.json');
const sha=text=>createHash('sha256').update(text).digest('hex');
function canonicalPath(value){
  if(typeof value!=='string')return null;let pathname;
  try{pathname=value.startsWith('/')?new URL(value,plan.origin).pathname:new URL(value).pathname;}catch{return null;}
  pathname=pathname.replace(/^\/_build\/[A-Za-z0-9_-]{1,80}(\/)/,'$1');return Object.hasOwn(plan.files,pathname)?pathname:null;
}
function instrument(text,requestPath){
  if(typeof text!=='string')return text;
  const key=canonicalPath(requestPath),file=key&&plan.files[key];if(!file)return text;
  const variants=file.variants?([...('sha256' in file?[file]:[]),...file.variants]):[file];
  let sample=text,spans=[],prefix,template='/_build/SP_BUILD_TEMPLATE/';
  let entry=variants.find(v=>v.sha256===sha(sample));
  if(!entry){
    let id;try{id=new URL(requestPath,plan.origin).pathname.match(/^\/_build\/([A-Za-z0-9_-]{1,80})\//)?.[1];}catch{}
    if(!id)return text;prefix='/_build/'+id+'/';let shift=0;
    sample=text.replaceAll(prefix,(value,at)=>{const start=at+shift;shift+=template.length-prefix.length;spans.push({start,end:start+template.length,delta:prefix.length-template.length});return template;});
    entry=variants.find(v=>v.sha256===sha(sample));if(!entry)return text;
  }
  let output=text;
  for(const edit of entry.edits){
    if(spans.some(s=>edit.offset>s.start&&edit.offset<s.end))return text;
    const offset=edit.offset+spans.filter(s=>s.end<=edit.offset).reduce((n,s)=>n+s.delta,0);
    output=output.slice(0,offset)+edit.text+output.slice(offset);
  }
  const checked=prefix?output.split(prefix).join(template):output;
  return sha(checked)===entry.transformedSha256?output:text;
}
async function transformResponse(request,response){
  let url;try{url=new URL(request.url);}catch{return response;}
  if(url.origin!==plan.origin||request.method!=='GET'||response.status!==200||!canonicalPath(url.pathname)||response.headers.has('content-range'))return response;
  let text;try{text=await response.clone().text();}catch{return response;}const output=instrument(text,url.pathname);if(output===text)return response;
  const headers=new Headers(response.headers);for(const key of ['content-length','content-encoding','transfer-encoding','etag','content-md5','digest'])headers.delete(key);
  headers.set('cache-control','no-store');headers.set('x-sp-desktop-unit-motion','1');return new Response(output,{status:response.status,statusText:response.statusText,headers});
}
module.exports={instrument,transformResponse,canonicalPath};
