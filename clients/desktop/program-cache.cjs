'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

// Frozen script URLs outlive a program upgrade. Invalidate HTTP cache once so
// Chromium cannot reuse pre-observer scripts. Cookies/local storage and the
// separately stored native resource library are intentionally left intact.
async function prepareProgramCache(session,directory,version){
  const marker=path.join(directory,'desktop-program-cache.json');
  let saved;try{saved=JSON.parse(await fs.readFile(marker,'utf8'));}catch{}
  if(saved?.version===version&&saved?.revision===1)return false;
  await session.clearCache();
  if(typeof session.clearCodeCaches==='function')await session.clearCodeCaches({});
  await fs.mkdir(directory,{recursive:true});
  const temp=marker+'.tmp';await fs.writeFile(temp,JSON.stringify({version,revision:1}));await fs.rename(temp,marker);
  return true;
}

module.exports={prepareProgramCache};
